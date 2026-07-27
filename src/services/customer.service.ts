import { Types } from "mongoose";

import type { ICustomer } from "../models/customers/Customer.js";
import {
  customerRepository,
  type CustomerCreateInput,
} from "../repositories/customer.repository.js";
import type {
  CreateCustomerBody,
  CustomerListQuery,
  UpdateCustomerBody,
  UpdateMyCustomerProfileBody,
} from "../validation/customer.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { withTransaction } from "../utils/database.js";
import { currentSystemDate } from "../utils/dateTime.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";

const toObjectId = (value: string): Types.ObjectId =>
  new Types.ObjectId(value);

const optionalObjectId = (
  value: string | null | undefined,
): Types.ObjectId | undefined =>
  value ? toObjectId(value) : undefined;

const optionalString = (
  value: string | null | undefined,
): string | undefined => value ?? undefined;

const assertDateOfBirthIsNotFuture = (
  dateOfBirth: string | null | undefined,
): void => {
  if (dateOfBirth && dateOfBirth > currentSystemDate()) {
    throw ApiError.badRequest(
      "Date of birth cannot be in the future",
      undefined,
      "INVALID_DATE_OF_BIRTH",
    );
  }
};

const assertCustomerIsEditable = (status: ICustomer["status"]): void => {
  if (status === "archived") {
    throw ApiError.conflict(
      "Archived customers must be restored before they can be changed",
      undefined,
      "CUSTOMER_ARCHIVED",
    );
  }
};

class CustomerService {
  async list(query: CustomerListQuery) {
    const result = await customerRepository.list({
      page: query.page,
      limit: query.limit,
      search: query.search,
      status: query.status,
      source: query.source,
      preferredBranchId: query.preferredBranchId
        ? toObjectId(query.preferredBranchId)
        : undefined,
    });

    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  }

  async getById(customerId: string) {
    const customer = await customerRepository.findById(
      toObjectId(customerId),
      true,
    );
    if (!customer) {
      throw ApiError.notFound("Customer was not found", "CUSTOMER_NOT_FOUND");
    }
    return customer;
  }

  async getMyProfile(userId: string) {
    const id = toObjectId(userId);
    const existing = await customerRepository.findByUserId(id);
    if (existing) return existing;

    const user = await customerRepository.findCustomerUser(id);
    if (!user || !user.isActive) {
      throw ApiError.notFound(
        "Customer profile was not found",
        "CUSTOMER_PROFILE_NOT_FOUND",
      );
    }

    try {
      return await customerRepository.create({
        userId: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        gender: "unspecified",
        tags: [],
        source: "online",
        status: "active",
      });
    } catch (error) {
      // Handles two first-time profile requests racing on the unique userId.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      ) {
        const racedProfile = await customerRepository.findByUserId(id);
        if (racedProfile) return racedProfile;
      }
      throw error;
    }
  }

  async updateMyProfile(
    userId: string,
    input: UpdateMyCustomerProfileBody,
    context: AuditActorContext,
  ) {
    assertDateOfBirthIsNotFuture(input.dateOfBirth);
    const id = toObjectId(userId);
    await this.getMyProfile(userId);

    await withTransaction(async (session) => {
      const [customer, user] = await Promise.all([
        customerRepository.findByUserId(id, session),
        customerRepository.findCustomerUser(id, session),
      ]);
      if (!customer || !user) {
        throw ApiError.notFound(
          "Customer profile was not found",
          "CUSTOMER_PROFILE_NOT_FOUND",
        );
      }
      assertCustomerIsEditable(customer.status);

      if (input.name !== undefined) {
        customer.name = input.name;
        user.name = input.name;
      }
      if (input.preferredName !== undefined) {
        customer.preferredName = optionalString(input.preferredName);
      }
      if (input.gender !== undefined) customer.gender = input.gender;
      if (input.dateOfBirth !== undefined) {
        customer.dateOfBirth = optionalString(input.dateOfBirth);
      }
      if (input.preferredBranchId !== undefined) {
        customer.preferredBranchId = optionalObjectId(
          input.preferredBranchId,
        );
      }
      if (input.preferredEmployeeId !== undefined) {
        customer.preferredEmployeeId = optionalObjectId(
          input.preferredEmployeeId,
        );
      }

      await this.assertPreferencesExist(
        customer.preferredBranchId,
        customer.preferredEmployeeId,
      );
      await customer.save({ session });
      if (user.isModified("name")) await user.save({ session });
      await recordAudit(
        {
          context,
          action: "customer.profile.updated",
          entityType: "Customer",
          entityId: customer._id,
          changes: { fields: Object.keys(input) },
        },
        session,
      );
    });
    return this.getMyProfile(userId);
  }

  async create(
    input: CreateCustomerBody,
    context: AuditActorContext,
  ) {
    assertDateOfBirthIsNotFuture(input.dateOfBirth);
    const userId = optionalObjectId(input.userId);
    const preferredBranchId = optionalObjectId(input.preferredBranchId);
    const preferredEmployeeId = optionalObjectId(input.preferredEmployeeId);

    if (userId) {
      const [user, existingProfile] = await Promise.all([
        customerRepository.findCustomerUser(userId),
        customerRepository.findByUserId(userId),
      ]);
      if (!user) {
        throw ApiError.badRequest(
          "userId must reference a customer account",
          undefined,
          "INVALID_CUSTOMER_USER",
        );
      }
      if (existingProfile) {
        throw ApiError.conflict(
          "That user already has a customer profile",
          { customerId: existingProfile._id },
          "CUSTOMER_PROFILE_EXISTS",
        );
      }
    }

    await this.assertPreferencesExist(
      preferredBranchId,
      preferredEmployeeId,
    );

    const createInput: CustomerCreateInput = {
      ...(userId ? { userId } : {}),
      name: input.name,
      preferredName: optionalString(input.preferredName),
      email: optionalString(input.email),
      phone: optionalString(input.phone),
      gender: input.gender,
      dateOfBirth: optionalString(input.dateOfBirth),
      preferredBranchId,
      preferredEmployeeId,
      tags: input.tags,
      internalNotes: optionalString(input.internalNotes),
      source: input.source,
      status: input.status,
      createdByUserId: context.actorUserId
        ? toObjectId(context.actorUserId.toString())
        : undefined,
    };

    const customer = await customerRepository.create(createInput);
    await recordAudit({
      context,
      action: "customer.created",
      entityType: "Customer",
      entityId: customer._id,
      changes: { source: input.source },
    });
    return customer;
  }

  async update(
    customerId: string,
    input: UpdateCustomerBody,
    context: AuditActorContext,
  ) {
    assertDateOfBirthIsNotFuture(input.dateOfBirth);
    const customer = await customerRepository.findById(
      toObjectId(customerId),
      true,
    );
    if (!customer) {
      throw ApiError.notFound("Customer was not found", "CUSTOMER_NOT_FOUND");
    }
    if (customer.status === "archived" && input.status === undefined) {
      assertCustomerIsEditable(customer.status);
    }

    if (input.name !== undefined) customer.name = input.name;
    if (input.preferredName !== undefined) {
      customer.preferredName = optionalString(input.preferredName);
    }
    if (input.email !== undefined) {
      customer.email = optionalString(input.email);
    }
    if (input.phone !== undefined) {
      customer.phone = optionalString(input.phone);
    }
    if (input.gender !== undefined) customer.gender = input.gender;
    if (input.dateOfBirth !== undefined) {
      customer.dateOfBirth = optionalString(input.dateOfBirth);
    }
    if (input.preferredBranchId !== undefined) {
      customer.preferredBranchId = optionalObjectId(
        input.preferredBranchId,
      );
    }
    if (input.preferredEmployeeId !== undefined) {
      customer.preferredEmployeeId = optionalObjectId(
        input.preferredEmployeeId,
      );
    }
    if (input.tags !== undefined) customer.tags = input.tags;
    if (input.internalNotes !== undefined) {
      customer.internalNotes = optionalString(input.internalNotes);
    }
    if (input.status !== undefined) customer.status = input.status;

    await this.assertPreferencesExist(
      customer.preferredBranchId,
      customer.preferredEmployeeId,
    );
    await customer.save();
    await recordAudit({
      context,
      action: "customer.updated",
      entityType: "Customer",
      entityId: customer._id,
      changes: { fields: Object.keys(input) },
    });
    return customer;
  }

  async archive(customerId: string, context: AuditActorContext) {
    const customer = await customerRepository.findById(
      toObjectId(customerId),
      true,
    );
    if (!customer) {
      throw ApiError.notFound("Customer was not found", "CUSTOMER_NOT_FOUND");
    }
    if (customer.status !== "archived") {
      customer.status = "archived";
      await customer.save();
      await recordAudit({
        context,
        action: "customer.archived",
        entityType: "Customer",
        entityId: customer._id,
      });
    }
  }

  private async assertPreferencesExist(
    preferredBranchId?: Types.ObjectId,
    preferredEmployeeId?: Types.ObjectId,
  ): Promise<void> {
    const [branchExists, employeeExists] = await Promise.all([
      preferredBranchId
        ? customerRepository.branchExists(preferredBranchId)
        : Promise.resolve(true),
      preferredEmployeeId
        ? customerRepository.employeeExists(preferredEmployeeId)
        : Promise.resolve(true),
    ]);

    if (!branchExists) {
      throw ApiError.badRequest(
        "Preferred branch must reference an active branch",
        undefined,
        "INVALID_PREFERRED_BRANCH",
      );
    }
    if (!employeeExists) {
      throw ApiError.badRequest(
        "Preferred employee must reference an active employee",
        undefined,
        "INVALID_PREFERRED_EMPLOYEE",
      );
    }
  }

}

export const customerService = new CustomerService();
