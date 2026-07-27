import { Types, type ClientSession } from "mongoose";

import type { IEmployee } from "../models/staff/Employee.js";
import {
  employeeRepository,
} from "../repositories/employee.repository.js";
import type {
  AdminListQuery,
  CreateAdminBody,
  CreateEmployeeBody,
  CreateLevelBody,
  CreateSkillBody,
  ProvisionEmployeeAccountBody,
  StaffAccessInput,
  UpdateAdminBody,
  UpdateEmployeeBody,
  UpdateLevelBody,
  UpdateMyEmployeeProfileBody,
  UpdateSkillBody,
  UpsertEmployeeServiceBody,
  UpsertEmployeeSkillBody,
} from "../validation/staff.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { withTransaction } from "../utils/database.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import { currentSystemDate } from "../utils/dateTime.js";
import { createLocalUser } from "./auth.service.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import {
  withBookingConfigWriteLease,
  withBookingConfigWriteLeases,
} from "./booking-config-lock.service.js";

const toObjectId = (value: string): Types.ObjectId =>
  new Types.ObjectId(value);

const optionalObjectId = (
  value: string | null | undefined,
): Types.ObjectId | undefined =>
  value ? toObjectId(value) : undefined;

const optionalString = (
  value: string | null | undefined,
): string | undefined => value ?? undefined;

const uniqueObjectIds = (values: string[]): Types.ObjectId[] =>
  [...new Set(values)].map(toObjectId);

const actorId = (context: AuditActorContext): Types.ObjectId | undefined =>
  context.actorUserId
    ? toObjectId(context.actorUserId.toString())
    : undefined;

const EMPLOYEE_AVAILABILITY_FIELDS = [
  "levelId",
  "branchIds",
  "status",
  "isBookable",
  "acceptsOnlineBookings",
  "servesClientGender",
  "maxConcurrentClients",
] as const satisfies readonly (keyof UpdateEmployeeBody)[];

const changesEmployeeAvailability = (input: UpdateEmployeeBody): boolean =>
  EMPLOYEE_AVAILABILITY_FIELDS.some((field) => input[field] !== undefined);

const mergeObjectIds = (
  ...groups: readonly Types.ObjectId[][]
): Types.ObjectId[] => [
  ...new Map(
    groups.flat().map((id) => [id.toString(), id] as const),
  ).values(),
];

const assertChronology = (
  start: string | null | undefined,
  end: string | null | undefined,
  message: string,
): void => {
  if (start && end && end <= start) {
    throw ApiError.badRequest(message, undefined, "INVALID_DATE_RANGE");
  }
};

const sanitizeEmployeeCreateInput = (
  input: CreateEmployeeBody,
  userId?: Types.ObjectId,
): Omit<IEmployee, "createdAt" | "updatedAt"> => ({
  ...(userId ? { userId } : {}),
  employeeCode: input.employeeCode,
  name: input.name,
  title: optionalString(input.title),
  levelId: optionalObjectId(input.levelId),
  workEmail: optionalString(input.workEmail),
  workPhone: optionalString(input.workPhone),
  branchIds: uniqueObjectIds(input.branchIds),
  primaryBranchId: optionalObjectId(input.primaryBranchId),
  employmentType: input.employmentType,
  status: input.status,
  isBookable: input.isBookable,
  acceptsOnlineBookings: input.acceptsOnlineBookings,
  servesClientGender: input.servesClientGender,
  maxConcurrentClients: input.maxConcurrentClients,
  bio: optionalString(input.bio),
  avatarUrl: optionalString(input.avatarUrl),
  calendarColor: input.calendarColor,
  hireDate: optionalString(input.hireDate),
  terminationDate: optionalString(input.terminationDate),
});

export interface EmployeeListInput {
  page: number;
  limit: number;
  search?: string;
  status?: IEmployee["status"];
  employmentType?: IEmployee["employmentType"];
  branchId?: string;
  levelId?: string;
  isBookable?: boolean;
}

export interface StaffScope {
  allBranches: boolean;
  branchIds: string[];
  permissions: string[];
}

export const assertEmployeeManagementScope = (
  scope: StaffScope,
  employeeBranchIds: readonly Types.ObjectId[],
): void => {
  if (scope.allBranches) return;

  const granted = new Set(scope.branchIds);
  if (
    employeeBranchIds.length === 0 ||
    employeeBranchIds.some((branchId) => !granted.has(branchId.toString()))
  ) {
    throw ApiError.forbidden(
      "Managing this shared employee requires access to every assigned branch",
      "EMPLOYEE_FULL_BRANCH_SCOPE_REQUIRED",
    );
  }
};

export const assertEmployeeAccessStatus = (
  employeeStatus: IEmployee["status"],
  accessStatus: StaffAccessInput["status"],
): void => {
  if (
    accessStatus === "active" &&
    employeeStatus !== "active" &&
    employeeStatus !== "on_leave"
  ) {
    throw ApiError.conflict(
      "Active staff access requires an active or on-leave employee",
      undefined,
      "EMPLOYEE_STATUS_ACCESS_CONFLICT",
    );
  }
};

class EmployeeService {
  async list(query: EmployeeListInput, scope: StaffScope) {
    if (
      query.branchId &&
      !scope.allBranches &&
      !scope.branchIds.includes(query.branchId)
    ) {
      throw ApiError.forbidden(
        "You do not have access to this branch",
        "BRANCH_ACCESS_FORBIDDEN",
      );
    }
    const result = await employeeRepository.list({
      ...query,
      branchId: query.branchId ? toObjectId(query.branchId) : undefined,
      levelId: query.levelId ? toObjectId(query.levelId) : undefined,
      allowedBranchIds: scope.allBranches
        ? undefined
        : scope.branchIds.map(toObjectId),
    });
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  }

  async getById(employeeId: string, scope?: StaffScope) {
    const employee = await employeeRepository.findById(toObjectId(employeeId));
    if (!employee) {
      throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
    }
    if (scope) this.assertScopeCanAccessEmployee(scope, employee.branchIds);

    const [account, access, skills, services] = await Promise.all([
      employee.userId
        ? employeeRepository.findPublicUserById(employee.userId)
        : Promise.resolve(null),
      employee.userId
        ? employeeRepository.findAccessByUserId(employee.userId)
        : Promise.resolve(null),
      employeeRepository.listEmployeeSkills(employee._id),
      employeeRepository.listEmployeeServices(employee._id),
    ]);

    return { employee, account, access, skills, services };
  }

  async getMyProfile(userId: string) {
    const id = toObjectId(userId);
    const employee = await employeeRepository.findByUserId(id);
    if (!employee) {
      throw ApiError.notFound(
        "Employee profile was not found",
        "EMPLOYEE_PROFILE_NOT_FOUND",
      );
    }

    const [account, access, skills, services] = await Promise.all([
      employeeRepository.findPublicUserById(id),
      employeeRepository.findAccessByUserId(id),
      employeeRepository.listEmployeeSkills(employee._id),
      employeeRepository.listEmployeeServices(employee._id),
    ]);
    return { employee, account, access, skills, services };
  }

  async create(
    input: CreateEmployeeBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    assertChronology(
      input.hireDate,
      input.terminationDate,
      "Termination date must be after hire date",
    );
    if (input.access) {
      assertEmployeeAccessStatus(input.status, input.access.status);
    }
    const branchIds = uniqueObjectIds(input.branchIds);
    if (!scope.allBranches && branchIds.length === 0) {
      throw ApiError.forbidden(
        "Branch-scoped staff must assign a branch when creating an employee",
        "EMPLOYEE_BRANCH_REQUIRED",
      );
    }
    this.assertScopeAllowsBranches(scope, branchIds);
    if (input.access) this.assertScopeCanGrantAccess(scope, input.access);
    const employeeId = await withBookingConfigWriteLeases(
      branchIds,
      async (guard) =>
        withTransaction(async (session) => {
          await this.assertEmployeeReferences(
            branchIds,
            optionalObjectId(input.levelId),
          );

          let userId: Types.ObjectId | undefined;
          if (input.account) {
            const user = await createLocalUser(
              {
                name: input.account.name,
                email: input.account.email,
                phone: input.account.phone,
                password: input.account.password,
                role: "employee",
              },
              { session },
            );
            if (input.account.avatarUrl) {
              user.avatarUrl = input.account.avatarUrl;
              await user.save({ session });
            }
            userId = user._id;
          }

          const employee = await employeeRepository.create(
            sanitizeEmployeeCreateInput(input, userId),
            session,
          );

          if (userId) {
            const access = input.access ?? {
              permissions: [],
              allBranches: branchIds.length === 0,
              branchIds: input.branchIds,
              status: input.status === "active" ? "active" : "invited",
            };
            await this.createAccess(
              userId,
              access,
              actorId(context),
              session,
              branchIds,
            );
          }

          await recordAudit(
            {
              context,
              action: "employee.created",
              entityType: "Employee",
              entityId: employee._id,
              changes: {
                employeeCode: employee.employeeCode,
                accountCreated: Boolean(userId),
              },
            },
            session,
          );
          await guard.assertValid();
          return employee._id;
        }),
    );

    return this.getById(employeeId.toString());
  }

  async update(
    employeeId: string,
    input: UpdateEmployeeBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    assertChronology(
      input.hireDate,
      input.terminationDate,
      "Termination date must be after hire date",
    );
    const id = toObjectId(employeeId);

    const currentEmployee = await employeeRepository.findDocumentById(id);
    if (!currentEmployee) {
      throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
    }
    assertEmployeeManagementScope(scope, currentEmployee.branchIds);
    const resultingBranchIds =
      input.branchIds !== undefined
        ? uniqueObjectIds(input.branchIds)
        : currentEmployee.branchIds;
    const lockedBranchIds = mergeObjectIds(
      currentEmployee.branchIds,
      resultingBranchIds,
    );

    const mutate = (assertValid: () => Promise<void>) =>
      withTransaction(async (session) => {
        const employee = await employeeRepository.findDocumentById(id, session);
        if (!employee) {
          throw ApiError.notFound(
            "Employee was not found",
            "EMPLOYEE_NOT_FOUND",
          );
        }
        assertEmployeeManagementScope(scope, employee.branchIds);

        const transactionBranchIds =
          input.branchIds !== undefined
            ? uniqueObjectIds(input.branchIds)
            : employee.branchIds;
        const resultingLevelId =
          input.levelId !== undefined
            ? optionalObjectId(input.levelId)
            : employee.levelId;
        this.assertScopeAllowsBranches(scope, transactionBranchIds);
        await this.assertEmployeeReferences(
          transactionBranchIds,
          resultingLevelId,
        );

        if (input.employeeCode !== undefined) {
          employee.employeeCode = input.employeeCode;
        }
        if (input.name !== undefined) employee.name = input.name;
        if (input.title !== undefined) {
          employee.title = optionalString(input.title);
        }
        if (input.levelId !== undefined) {
          employee.levelId = optionalObjectId(input.levelId);
        }
        if (input.workEmail !== undefined) {
          employee.workEmail = optionalString(input.workEmail);
        }
        if (input.workPhone !== undefined) {
          employee.workPhone = optionalString(input.workPhone);
        }
        if (input.branchIds !== undefined) {
          employee.branchIds = transactionBranchIds;
        }
        if (input.primaryBranchId !== undefined) {
          employee.primaryBranchId = optionalObjectId(input.primaryBranchId);
        }
        if (input.employmentType !== undefined) {
          employee.employmentType = input.employmentType;
        }
        if (input.status !== undefined) employee.status = input.status;
        if (input.isBookable !== undefined) {
          employee.isBookable = input.isBookable;
        }
        if (input.acceptsOnlineBookings !== undefined) {
          employee.acceptsOnlineBookings = input.acceptsOnlineBookings;
        }
        if (input.servesClientGender !== undefined) {
          employee.servesClientGender = input.servesClientGender;
        }
        if (input.maxConcurrentClients !== undefined) {
          employee.maxConcurrentClients = input.maxConcurrentClients;
        }
        if (input.bio !== undefined) employee.bio = optionalString(input.bio);
        if (input.avatarUrl !== undefined) {
          employee.avatarUrl = optionalString(input.avatarUrl);
        }
        if (input.calendarColor !== undefined) {
          employee.calendarColor = input.calendarColor;
        }
        if (input.hireDate !== undefined) {
          employee.hireDate = optionalString(input.hireDate);
        }
        if (input.terminationDate !== undefined) {
          employee.terminationDate = optionalString(input.terminationDate);
        }

        if (employee.status !== "active") {
          employee.isBookable = false;
          employee.acceptsOnlineBookings = false;
        }

        assertChronology(
          employee.hireDate,
          employee.terminationDate,
          "Termination date must be after hire date",
        );
        await employee.save({ session });

        if (employee.userId && input.status !== undefined) {
          await this.applyAccountStatusForEmployee(
            employee.userId,
            input.status,
            session,
          );
        }

        if (employee.userId && input.branchIds !== undefined) {
          const access = await employeeRepository.findAccessByUserIdInSession(
            employee.userId,
            session,
          );
          if (access && !access.allBranches) {
            const assignedBranches = new Set(
              employee.branchIds.map((branchId) => branchId.toString()),
            );
            const remainingAccessBranches = access.branchIds.filter(
              (branchId) => assignedBranches.has(branchId.toString()),
            );
            if (remainingAccessBranches.length === 0) {
              // Keep the former branch list for auditability, but suspend the
              // record so middleware cannot authorize it.
              access.status = "suspended";
            } else {
              access.branchIds = remainingAccessBranches;
            }
            await access.save({ session });
          }
        }

        await recordAudit(
          {
            context,
            action: "employee.updated",
            entityType: "Employee",
            entityId: employee._id,
            changes: { fields: Object.keys(input) },
          },
          session,
        );
        await assertValid();
      });

    if (changesEmployeeAvailability(input)) {
      await withBookingConfigWriteLeases(
        lockedBranchIds,
        (guard) => mutate(() => guard.assertValid()),
      );
    } else {
      await mutate(() => Promise.resolve());
    }

    return this.getById(employeeId);
  }

  async updateMyProfile(
    userId: string,
    input: UpdateMyEmployeeProfileBody,
    context: AuditActorContext,
  ) {
    const employee = await employeeRepository.findByUserId(toObjectId(userId));
    if (!employee) {
      throw ApiError.notFound(
        "Employee profile was not found",
        "EMPLOYEE_PROFILE_NOT_FOUND",
      );
    }
    if (employee.status === "terminated") {
      throw ApiError.forbidden(
        "Terminated employee profiles cannot be changed",
        "EMPLOYEE_TERMINATED",
      );
    }

    if (input.bio !== undefined) employee.bio = optionalString(input.bio);
    if (input.avatarUrl !== undefined) {
      employee.avatarUrl = optionalString(input.avatarUrl);
    }
    if (input.calendarColor !== undefined) {
      employee.calendarColor = input.calendarColor;
    }
    await employee.save();
    await recordAudit({
      context,
      action: "employee.profile.updated",
      entityType: "Employee",
      entityId: employee._id,
      changes: { fields: Object.keys(input) },
    });
    return employee;
  }

  async provisionAccount(
    employeeId: string,
    input: ProvisionEmployeeAccountBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    const id = toObjectId(employeeId);
    const currentEmployee = await this.assertEmployeeExists(id);
    assertEmployeeManagementScope(scope, currentEmployee.branchIds);

    const mutate = (assertValid: () => Promise<void>) =>
      withTransaction(async (session) => {
        const employee = await employeeRepository.findDocumentById(id, session);
        if (!employee) {
          throw ApiError.notFound(
            "Employee was not found",
            "EMPLOYEE_NOT_FOUND",
          );
        }
        assertEmployeeManagementScope(scope, employee.branchIds);
        this.assertScopeCanGrantAccess(scope, input.access);
        if (employee.userId) {
          throw ApiError.conflict(
            "Employee already has a login account",
            undefined,
            "EMPLOYEE_ACCOUNT_EXISTS",
          );
        }
        if (input.activateEmployee && employee.branchIds.length === 0) {
          throw ApiError.conflict(
            "Assign the employee to a branch before activation",
            undefined,
            "EMPLOYEE_BRANCH_REQUIRED",
          );
        }
        assertEmployeeAccessStatus(
          input.activateEmployee ? "active" : employee.status,
          input.access.status,
        );

        const user = await createLocalUser(
          {
            name: input.account.name,
            email: input.account.email,
            phone: input.account.phone,
            password: input.account.password,
            role: "employee",
          },
          { session },
        );
        if (input.account.avatarUrl) {
          user.avatarUrl = input.account.avatarUrl;
          await user.save({ session });
        }

        employee.userId = user._id;
        if (input.activateEmployee) employee.status = "active";
        await employee.save({ session });
        const access = await this.createAccess(
          user._id,
          input.access,
          actorId(context),
          session,
          employee.branchIds,
        );
        await recordAudit(
          {
            context,
            action: "employee.account.provisioned",
            entityType: "Employee",
            entityId: employee._id,
            changes: { userId: user._id, accessId: access._id },
          },
          session,
        );
        await assertValid();
      });

    if (input.activateEmployee) {
      await withBookingConfigWriteLeases(
        currentEmployee.branchIds,
        (guard) => mutate(() => guard.assertValid()),
      );
    } else {
      await mutate(() => Promise.resolve());
    }
    return this.getById(employeeId, scope);
  }

  async terminate(
    employeeId: string,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    const id = toObjectId(employeeId);
    const currentEmployee = await this.assertEmployeeExists(id);
    assertEmployeeManagementScope(scope, currentEmployee.branchIds);

    await withBookingConfigWriteLeases(
      currentEmployee.branchIds,
      async (guard) =>
        withTransaction(async (session) => {
          const employee = await employeeRepository.findDocumentById(
            id,
            session,
          );
          if (!employee) {
            throw ApiError.notFound(
              "Employee was not found",
              "EMPLOYEE_NOT_FOUND",
            );
          }
          assertEmployeeManagementScope(scope, employee.branchIds);
          employee.status = "terminated";
          employee.isBookable = false;
          employee.acceptsOnlineBookings = false;
          if (
            !employee.terminationDate &&
            (!employee.hireDate || employee.hireDate < currentSystemDate())
          ) {
            employee.terminationDate = currentSystemDate();
          }
          await employee.save({ session });
          if (employee.userId) {
            await this.applyAccountStatusForEmployee(
              employee.userId,
              "terminated",
              session,
            );
          }
          await recordAudit(
            {
              context,
              action: "employee.terminated",
              entityType: "Employee",
              entityId: employee._id,
            },
            session,
          );
          await guard.assertValid();
        }),
    );
  }

  async getAccess(employeeId: string, scope?: StaffScope) {
    const employee = await employeeRepository.findDocumentById(
      toObjectId(employeeId),
    );
    if (!employee) {
      throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
    }
    if (scope) this.assertScopeCanAccessEmployee(scope, employee.branchIds);
    if (!employee.userId) {
      throw ApiError.notFound(
        "Employee does not have a login account",
        "EMPLOYEE_ACCOUNT_NOT_FOUND",
      );
    }
    const access = await employeeRepository.findAccessByUserId(employee.userId);
    if (!access) {
      throw ApiError.notFound(
        "Employee access record was not found",
        "STAFF_ACCESS_NOT_FOUND",
      );
    }
    return access;
  }

  async updateAccess(
    employeeId: string,
    input: StaffAccessInput,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    const id = toObjectId(employeeId);
    await withTransaction(async (session) => {
      const employee = await employeeRepository.findDocumentById(id, session);
      if (!employee) {
        throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
      }
      assertEmployeeManagementScope(scope, employee.branchIds);
      this.assertScopeCanGrantAccess(scope, input);
      assertEmployeeAccessStatus(employee.status, input.status);
      if (!employee.userId) {
        throw ApiError.conflict(
          "Create a login account for the employee before assigning access",
          undefined,
          "EMPLOYEE_ACCOUNT_REQUIRED",
        );
      }

      await this.assertAccessBranches(input, employee.branchIds);
      let access = await employeeRepository.findAccessByUserIdInSession(
        employee.userId,
        session,
      );
      if (!access) {
        access = await this.createAccess(
          employee.userId,
          input,
          actorId(context),
          session,
          employee.branchIds,
        );
      } else {
        access.permissions = input.permissions;
        access.allBranches = input.allBranches;
        access.branchIds = input.allBranches
          ? []
          : uniqueObjectIds(input.branchIds);
        access.status = input.status;
        if (input.status === "active" && !access.joinedAt) {
          access.joinedAt = new Date();
        }
        await access.save({ session });
      }

      await recordAudit(
        {
          context,
          action: "employee.access.updated",
          entityType: "StaffAccess",
          entityId: access._id,
          changes: {
            employeeId: employee._id,
            permissions: input.permissions,
            status: input.status,
            allBranches: input.allBranches,
          },
        },
        session,
      );
    });
    return this.getAccess(employeeId, scope);
  }

  async listSkills(employeeId: string, scope: StaffScope) {
    const employee = await this.assertEmployeeExists(toObjectId(employeeId));
    this.assertScopeCanAccessEmployee(scope, employee.branchIds);
    return employeeRepository.listEmployeeSkills(toObjectId(employeeId));
  }

  async upsertSkill(
    employeeId: string,
    skillId: string,
    input: UpsertEmployeeSkillBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    assertChronology(
      input.certifiedAt,
      input.expiresAt,
      "Skill expiry must be after certification date",
    );
    const employeeObjectId = toObjectId(employeeId);
    const skillObjectId = toObjectId(skillId);
    const employee =
      await employeeRepository.findDocumentById(employeeObjectId);
    if (!employee) {
      throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
    }
    assertEmployeeManagementScope(scope, employee.branchIds);

    return withBookingConfigWriteLeases(
      employee.branchIds,
      async (guard) => {
        const skill = await employeeRepository.findSkillById(skillObjectId);
        if (!skill || !skill.isActive) {
          throw ApiError.badRequest(
            "Skill must reference an active skill",
            undefined,
            "INVALID_SKILL",
          );
        }

        let assignment = await employeeRepository.findEmployeeSkill(
          employeeObjectId,
          skillObjectId,
        );
        const created = !assignment;
        await guard.assertValid();
        assignment ??= await employeeRepository.createEmployeeSkill({
          employeeId: employeeObjectId,
          skillId: skillObjectId,
          proficiency: input.proficiency,
          certifiedAt: optionalString(input.certifiedAt),
          expiresAt: optionalString(input.expiresAt),
          isActive: input.isActive,
        });
        if (!created) {
          assignment.proficiency = input.proficiency;
          assignment.certifiedAt = optionalString(input.certifiedAt);
          assignment.expiresAt = optionalString(input.expiresAt);
          assignment.isActive = input.isActive;
          await assignment.save();
        }
        await recordAudit({
          context,
          action: created
            ? "employee.skill.assigned"
            : "employee.skill.updated",
          entityType: "EmployeeSkill",
          entityId: assignment._id,
          changes: { employeeId: employeeObjectId, skillId: skillObjectId },
        });
        return assignment;
      },
    );
  }

  async removeSkill(
    employeeId: string,
    skillId: string,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    const employee = await this.assertEmployeeExists(toObjectId(employeeId));
    assertEmployeeManagementScope(scope, employee.branchIds);
    await withBookingConfigWriteLeases(
      employee.branchIds,
      async (guard) => {
        const assignment = await employeeRepository.findEmployeeSkill(
          toObjectId(employeeId),
          toObjectId(skillId),
        );
        if (!assignment) {
          throw ApiError.notFound(
            "Employee skill assignment was not found",
            "EMPLOYEE_SKILL_NOT_FOUND",
          );
        }
        assignment.isActive = false;
        await guard.assertValid();
        await assignment.save();
        await recordAudit({
          context,
          action: "employee.skill.removed",
          entityType: "EmployeeSkill",
          entityId: assignment._id,
        });
      },
    );
  }

  async listServices(
    employeeId: string,
    branchId: string | undefined,
    scope: StaffScope,
  ) {
    const employeeObjectId = toObjectId(employeeId);
    const employee = await this.assertEmployeeExists(employeeObjectId);
    this.assertScopeCanAccessEmployee(scope, employee.branchIds);
    if (
      branchId &&
      !scope.allBranches &&
      !scope.branchIds.includes(branchId)
    ) {
      throw ApiError.forbidden(
        "You do not have access to this branch",
        "BRANCH_ACCESS_FORBIDDEN",
      );
    }
    return employeeRepository.listEmployeeServices(
      employeeObjectId,
      branchId ? toObjectId(branchId) : undefined,
    );
  }

  async upsertService(
    employeeId: string,
    serviceId: string,
    branchId: string,
    input: UpsertEmployeeServiceBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    assertChronology(
      input.validFrom,
      input.validUntil,
      "Service validity end must be after its start",
    );
    const employeeObjectId = toObjectId(employeeId);
    const serviceObjectId = toObjectId(serviceId);
    const branchObjectId = toObjectId(branchId);
    const employee =
      await employeeRepository.findDocumentById(employeeObjectId);
    if (!employee) {
      throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
    }
    this.assertScopeCanAccessEmployee(scope, employee.branchIds);
    this.assertScopeAllowsBranches(scope, [branchObjectId]);

    return withBookingConfigWriteLease(
      branchObjectId,
      async (guard) => {
        const [currentEmployee, serviceExists, branchServiceExists] =
          await Promise.all([
            employeeRepository.findDocumentById(employeeObjectId),
            employeeRepository.serviceExists(serviceObjectId),
            employeeRepository.branchServiceExists(
              branchObjectId,
              serviceObjectId,
            ),
          ]);
        if (!currentEmployee) {
          throw ApiError.notFound(
            "Employee was not found",
            "EMPLOYEE_NOT_FOUND",
          );
        }
        if (
          !currentEmployee.branchIds.some((id) => id.equals(branchObjectId))
        ) {
          throw ApiError.badRequest(
            "Employee must be assigned to this branch",
            undefined,
            "EMPLOYEE_BRANCH_REQUIRED",
          );
        }
        if (!serviceExists || !branchServiceExists) {
          throw ApiError.badRequest(
            "Service must be active and enabled at this branch",
            undefined,
            "INVALID_BRANCH_SERVICE",
          );
        }

        let assignment = await employeeRepository.findEmployeeService(
          employeeObjectId,
          serviceObjectId,
          branchObjectId,
        );
        const created = !assignment;
        await guard.assertValid();
        assignment ??= await employeeRepository.createEmployeeService({
          employeeId: employeeObjectId,
          serviceId: serviceObjectId,
          branchId: branchObjectId,
          proficiency: input.proficiency,
          priceOverride: input.priceOverride ?? undefined,
          durationOverride: input.durationOverride ?? undefined,
          servesClientGenderOverride:
            input.servesClientGenderOverride ?? undefined,
          isActive: input.isActive,
          isOnlineBookable: input.isActive && input.isOnlineBookable,
          validFrom: optionalString(input.validFrom),
          validUntil: optionalString(input.validUntil),
        });
        if (!created) {
          assignment.proficiency = input.proficiency;
          assignment.priceOverride = input.priceOverride ?? undefined;
          assignment.durationOverride = input.durationOverride ?? undefined;
          assignment.servesClientGenderOverride =
            input.servesClientGenderOverride ?? undefined;
          assignment.isActive = input.isActive;
          assignment.isOnlineBookable =
            input.isActive && input.isOnlineBookable;
          assignment.validFrom = optionalString(input.validFrom);
          assignment.validUntil = optionalString(input.validUntil);
          await assignment.save();
        }
        await recordAudit({
          context,
          action: created
            ? "employee.service.assigned"
            : "employee.service.updated",
          entityType: "EmployeeService",
          entityId: assignment._id,
          changes: {
            employeeId: employeeObjectId,
            serviceId: serviceObjectId,
            branchId: branchObjectId,
          },
        });
        return assignment;
      },
    );
  }

  async removeService(
    employeeId: string,
    serviceId: string,
    branchId: string,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    const employee = await this.assertEmployeeExists(toObjectId(employeeId));
    this.assertScopeCanAccessEmployee(scope, employee.branchIds);
    this.assertScopeAllowsBranches(scope, [toObjectId(branchId)]);
    await withBookingConfigWriteLease(
      branchId,
      async (guard) => {
        const assignment = await employeeRepository.findEmployeeService(
          toObjectId(employeeId),
          toObjectId(serviceId),
          toObjectId(branchId),
        );
        if (!assignment) {
          throw ApiError.notFound(
            "Employee service assignment was not found",
            "EMPLOYEE_SERVICE_NOT_FOUND",
          );
        }
        assignment.isActive = false;
        assignment.isOnlineBookable = false;
        await guard.assertValid();
        await assignment.save();
        await recordAudit({
          context,
          action: "employee.service.removed",
          entityType: "EmployeeService",
          entityId: assignment._id,
        });
      },
    );
  }

  async listAllSkills(activeOnly: boolean) {
    return employeeRepository.listSkills(activeOnly);
  }

  async createSkill(
    input: CreateSkillBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    this.assertGlobalStaffScope(scope);
    const skill = await employeeRepository.createSkill({
      name: input.name,
      code: input.code,
      description: optionalString(input.description),
      isActive: input.isActive,
    });
    await recordAudit({
      context,
      action: "skill.created",
      entityType: "Skill",
      entityId: skill._id,
    });
    return skill;
  }

  async updateSkill(
    skillId: string,
    input: UpdateSkillBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    this.assertGlobalStaffScope(scope);
    const skill = await employeeRepository.findSkillById(toObjectId(skillId));
    if (!skill) throw ApiError.notFound("Skill was not found", "SKILL_NOT_FOUND");
    if (input.name !== undefined) skill.name = input.name;
    if (input.code !== undefined) skill.code = input.code;
    if (input.description !== undefined) {
      skill.description = optionalString(input.description);
    }
    if (input.isActive !== undefined) skill.isActive = input.isActive;
    await skill.save();
    await recordAudit({
      context,
      action: "skill.updated",
      entityType: "Skill",
      entityId: skill._id,
      changes: { fields: Object.keys(input) },
    });
    return skill;
  }

  async deactivateSkill(
    skillId: string,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    return this.updateSkill(skillId, { isActive: false }, context, scope);
  }

  async listLevels(activeOnly: boolean) {
    return employeeRepository.listLevels(activeOnly);
  }

  async createLevel(
    input: CreateLevelBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    this.assertGlobalStaffScope(scope);
    const level = await employeeRepository.createLevel({
      name: input.name,
      code: input.code,
      rank: input.rank,
      isActive: input.isActive,
    });
    await recordAudit({
      context,
      action: "employee_level.created",
      entityType: "EmployeeLevel",
      entityId: level._id,
    });
    return level;
  }

  async updateLevel(
    levelId: string,
    input: UpdateLevelBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    this.assertGlobalStaffScope(scope);
    const level = await employeeRepository.findLevelById(toObjectId(levelId));
    if (!level) {
      throw ApiError.notFound(
        "Employee level was not found",
        "EMPLOYEE_LEVEL_NOT_FOUND",
      );
    }
    if (input.name !== undefined) level.name = input.name;
    if (input.code !== undefined) level.code = input.code;
    if (input.rank !== undefined) level.rank = input.rank;
    if (input.isActive !== undefined) level.isActive = input.isActive;
    await level.save();
    await recordAudit({
      context,
      action: "employee_level.updated",
      entityType: "EmployeeLevel",
      entityId: level._id,
      changes: { fields: Object.keys(input) },
    });
    return level;
  }

  async deactivateLevel(
    levelId: string,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    return this.updateLevel(levelId, { isActive: false }, context, scope);
  }

  async listAdmins(query: AdminListQuery, scope: StaffScope) {
    this.assertGlobalStaffScope(scope);
    const result = await employeeRepository.listAdmins(query);
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  }

  async getAdmin(adminId: string, scope?: StaffScope) {
    if (scope) this.assertGlobalStaffScope(scope);
    const id = toObjectId(adminId);
    const [admin, access] = await Promise.all([
      employeeRepository.findAdminById(id),
      employeeRepository.findAccessByUserId(id),
    ]);
    if (!admin) {
      throw ApiError.notFound("Administrator was not found", "ADMIN_NOT_FOUND");
    }
    return { admin, access };
  }

  async createAdmin(
    input: CreateAdminBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    this.assertGlobalStaffScope(scope);
    this.assertScopeCanGrantAccess(scope, input.access);
    const adminId = await withTransaction(async (session) => {
      await this.assertAccessBranches(input.access);
      const user = await createLocalUser(
        {
          name: input.account.name,
          email: input.account.email,
          phone: input.account.phone,
          password: input.account.password,
          role: "admin",
        },
        { session },
      );
      if (input.account.avatarUrl) {
        user.avatarUrl = input.account.avatarUrl;
        await user.save({ session });
      }
      const access = await this.createAccess(
        user._id,
        input.access,
        actorId(context),
        session,
      );
      await recordAudit(
        {
          context,
          action: "admin.created",
          entityType: "User",
          entityId: user._id,
          changes: { accessId: access._id },
        },
        session,
      );
      return user._id;
    });
    return this.getAdmin(adminId.toString());
  }

  async updateAdmin(
    adminId: string,
    input: UpdateAdminBody,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    this.assertGlobalStaffScope(scope);
    const id = toObjectId(adminId);
    if (
      input.isActive === false &&
      context.actorUserId?.toString() === adminId
    ) {
      throw ApiError.conflict(
        "Administrators cannot disable their own account",
        undefined,
        "SELF_DEACTIVATION_FORBIDDEN",
      );
    }

    await withTransaction(async (session) => {
      const admin = await employeeRepository.findAdminDocumentById(id, session);
      if (!admin) {
        throw ApiError.notFound("Administrator was not found", "ADMIN_NOT_FOUND");
      }
      if (input.name !== undefined) admin.name = input.name;
      if (input.avatarUrl !== undefined) {
        admin.avatarUrl = optionalString(input.avatarUrl);
      }
      if (input.isActive !== undefined && input.isActive !== admin.isActive) {
        admin.isActive = input.isActive;
        admin.tokenVersion += 1;
        const access = await employeeRepository.findAccessByUserIdInSession(
          admin._id,
          session,
        );
        if (access && !input.isActive) {
          access.status = "suspended";
          await access.save({ session });
        }
      }
      await admin.save({ session });
      await recordAudit(
        {
          context,
          action: "admin.updated",
          entityType: "User",
          entityId: admin._id,
          changes: { fields: Object.keys(input) },
        },
        session,
      );
    });
    return this.getAdmin(adminId, scope);
  }

  async updateAdminAccess(
    adminId: string,
    input: StaffAccessInput,
    context: AuditActorContext,
    scope: StaffScope,
  ) {
    this.assertGlobalStaffScope(scope);
    this.assertScopeCanGrantAccess(scope, input);
    const id = toObjectId(adminId);
    if (context.actorUserId?.toString() === adminId) {
      throw ApiError.conflict(
        "Administrators cannot change their own access policy; use another administrator account",
        undefined,
        "SELF_ACCESS_CHANGE_FORBIDDEN",
      );
    }
    await this.assertAccessBranches(input);

    await withTransaction(async (session) => {
      const admin = await employeeRepository.findAdminDocumentById(id, session);
      if (!admin) {
        throw ApiError.notFound("Administrator was not found", "ADMIN_NOT_FOUND");
      }
      let access = await employeeRepository.findAccessByUserIdInSession(
        id,
        session,
      );
      if (!access) {
        access = await this.createAccess(
          id,
          input,
          actorId(context),
          session,
        );
      } else {
        access.permissions = input.permissions;
        access.allBranches = input.allBranches;
        access.branchIds = input.allBranches
          ? []
          : uniqueObjectIds(input.branchIds);
        access.status = input.status;
        if (input.status === "active" && !access.joinedAt) {
          access.joinedAt = new Date();
        }
        await access.save({ session });
      }
      await recordAudit(
        {
          context,
          action: "admin.access.updated",
          entityType: "StaffAccess",
          entityId: access._id,
          changes: {
            adminId: id,
            permissions: input.permissions,
            status: input.status,
            allBranches: input.allBranches,
          },
        },
        session,
      );
    });
    return this.getAdmin(adminId, scope);
  }

  private async assertEmployeeExists(employeeId: Types.ObjectId) {
    const employee = await employeeRepository.findDocumentById(employeeId);
    if (!employee) {
      throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
    }
    return employee;
  }

  private assertScopeAllowsBranches(
    scope: StaffScope,
    branchIds: Types.ObjectId[],
  ): void {
    if (scope.allBranches) return;
    const granted = new Set(scope.branchIds);
    if (branchIds.some((branchId) => !granted.has(branchId.toString()))) {
      throw ApiError.forbidden(
        "You cannot manage staff outside your assigned branches",
        "BRANCH_ACCESS_FORBIDDEN",
      );
    }
  }

  private assertScopeCanAccessEmployee(
    scope: StaffScope,
    employeeBranchIds: Types.ObjectId[],
  ): void {
    if (scope.allBranches) return;
    const granted = new Set(scope.branchIds);
    if (
      employeeBranchIds.length === 0 ||
      !employeeBranchIds.some((branchId) => granted.has(branchId.toString()))
    ) {
      throw ApiError.forbidden(
        "You cannot access this employee",
        "EMPLOYEE_BRANCH_FORBIDDEN",
      );
    }
  }

  private assertScopeCanGrantAccess(
    scope: StaffScope,
    access: StaffAccessInput,
  ): void {
    const grantedPermissions = new Set(scope.permissions);
    const ungrantablePermissions = access.permissions.filter(
      (permission) => !grantedPermissions.has(permission),
    );
    if (ungrantablePermissions.length > 0) {
      throw new ApiError(403, "You cannot grant permissions you do not have", {
        code: "PERMISSION_GRANT_FORBIDDEN",
        details: { permissions: ungrantablePermissions },
      });
    }
    if (scope.allBranches) return;
    if (access.allBranches) {
      throw ApiError.forbidden(
        "Branch-scoped staff cannot grant all-branch access",
        "ACCESS_GRANT_FORBIDDEN",
      );
    }
    this.assertScopeAllowsBranches(
      scope,
      uniqueObjectIds(access.branchIds),
    );
  }

  private assertGlobalStaffScope(scope: StaffScope): void {
    if (!scope.allBranches) {
      throw ApiError.forbidden(
        "All-branch staff access is required",
        "GLOBAL_STAFF_ACCESS_REQUIRED",
      );
    }
  }

  private async assertEmployeeReferences(
    branchIds: Types.ObjectId[],
    levelId?: Types.ObjectId,
  ): Promise<void> {
    const uniqueBranchIds = [
      ...new Map(branchIds.map((id) => [id.toString(), id])).values(),
    ];
    const [existingBranchCount, level] = await Promise.all([
      uniqueBranchIds.length
        ? employeeRepository.branchesExist(uniqueBranchIds)
        : Promise.resolve(0),
      levelId
        ? employeeRepository.findLevelById(levelId)
        : Promise.resolve(null),
    ]);
    if (existingBranchCount !== uniqueBranchIds.length) {
      throw ApiError.badRequest(
        "Every assigned branch must reference an active branch",
        undefined,
        "INVALID_EMPLOYEE_BRANCH",
      );
    }
    if (levelId && (!level || !level.isActive)) {
      throw ApiError.badRequest(
        "Employee level must reference an active level",
        undefined,
        "INVALID_EMPLOYEE_LEVEL",
      );
    }
  }

  private async assertAccessBranches(
    input: StaffAccessInput,
    employeeBranchIds?: Types.ObjectId[],
  ): Promise<void> {
    if (input.allBranches) return;
    const branchIds = uniqueObjectIds(input.branchIds);
    const count = await employeeRepository.branchesExist(branchIds);
    if (count !== branchIds.length) {
      throw ApiError.badRequest(
        "Every access branch must reference an active branch",
        undefined,
        "INVALID_ACCESS_BRANCH",
      );
    }
    if (
      employeeBranchIds &&
      branchIds.some(
        (branchId) =>
          !employeeBranchIds.some((assignedId) =>
            assignedId.equals(branchId),
          ),
      )
    ) {
      throw ApiError.badRequest(
        "Employee access cannot include an unassigned branch",
        undefined,
        "ACCESS_OUTSIDE_EMPLOYEE_BRANCHES",
      );
    }
  }

  private async createAccess(
    userId: Types.ObjectId,
    input: StaffAccessInput,
    invitedByUserId: Types.ObjectId | undefined,
    session: ClientSession,
    employeeBranchIds?: Types.ObjectId[],
  ) {
    await this.assertAccessBranches(input, employeeBranchIds);
    return employeeRepository.createAccess(
      {
        userId,
        permissions: input.permissions,
        allBranches: input.allBranches,
        branchIds: input.allBranches ? [] : uniqueObjectIds(input.branchIds),
        requiredAuthMethod: "local",
        status: input.status,
        invitedByUserId,
        joinedAt: input.status === "active" ? new Date() : undefined,
      },
      session,
    );
  }

  private async applyAccountStatusForEmployee(
    userId: Types.ObjectId,
    status: IEmployee["status"],
    session: ClientSession,
  ): Promise<void> {
    const employeeUser =
      await employeeRepository.findEmployeeUserDocumentById(userId, session);
    if (!employeeUser) {
      throw ApiError.conflict(
        "Employee login account is missing",
        undefined,
        "EMPLOYEE_ACCOUNT_NOT_FOUND",
      );
    }

    const access = await employeeRepository.findAccessByUserIdInSession(
      userId,
      session,
    );
    if (status === "active") {
      employeeUser.isActive = true;
      if (access) {
        access.status = "active";
        access.joinedAt ??= new Date();
      }
    } else if (status === "terminated") {
      employeeUser.isActive = false;
      employeeUser.tokenVersion += 1;
      if (access) access.status = "revoked";
    } else if (status === "inactive") {
      employeeUser.isActive = false;
      employeeUser.tokenVersion += 1;
      if (access) access.status = "suspended";
    } else if (status === "invited" && access) {
      access.status = "invited";
    }
    await employeeUser.save({ session });
    if (access) await access.save({ session });
  }
}

export const employeeService = new EmployeeService();
