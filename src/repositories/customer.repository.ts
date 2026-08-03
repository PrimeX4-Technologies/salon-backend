import type { ClientSession, QueryFilter, Types } from "mongoose";

import Customer, {
  type ICustomer,
} from "../models/customers/Customer.js";
import User from "../models/auth/User.js";
import Branch from "../models/business/Branch.js";
import Employee from "../models/staff/Employee.js";

export interface CustomerListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: ICustomer["status"];
  source?: ICustomer["source"];
  preferredBranchId?: Types.ObjectId;
}

export interface CustomerListResult {
  items: Array<Record<string, unknown>>;
  total: number;
}

export type CustomerCreateInput = Omit<ICustomer, "createdAt" | "updatedAt">;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildListFilter = (
  filters: CustomerListFilters,
): QueryFilter<ICustomer> => {
  const query: QueryFilter<ICustomer> = {};

  if (filters.status) query.status = filters.status;
  if (filters.source) query.source = filters.source;
  if (filters.preferredBranchId) {
    query.preferredBranchId = filters.preferredBranchId;
  }

  if (filters.search) {
    const expression = new RegExp(escapeRegExp(filters.search), "i");
    query.$or = [
      { name: expression },
      { preferredName: expression },
      { email: expression },
      { phone: expression },
    ];
  }

  return query;
};

export class CustomerRepository {
  async list(filters: CustomerListFilters): Promise<CustomerListResult> {
    const query = buildListFilter(filters);
    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      Customer.find(query)
        .select("+internalNotes")
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(filters.limit)
        .lean()
        .exec(),
      Customer.countDocuments(query).exec(),
    ]);

    return {
      items: items as unknown as Array<Record<string, unknown>>,
      total,
    };
  }

  findById(id: Types.ObjectId, includeInternalNotes = false) {
    const query = Customer.findById(id);
    if (includeInternalNotes) query.select("+internalNotes");
    return query.exec();
  }

  findByUserId(userId: Types.ObjectId, session?: ClientSession) {
    return Customer.findOne({ userId }).session(session ?? null).exec();
  }

  findCustomerUser(userId: Types.ObjectId, session?: ClientSession) {
    return User.findOne({ _id: userId, role: "customer" })
      .session(session ?? null)
      .exec();
  }

  branchExists(branchId: Types.ObjectId) {
    return Branch.exists({ _id: branchId, isActive: true }).exec();
  }

  employeeExists(employeeId: Types.ObjectId) {
    return Employee.exists({
      _id: employeeId,
      status: "active",
    }).exec();
  }

  findByContact(email?: string, phone?: string) {
    const contacts: QueryFilter<ICustomer>[] = [];
    if (email) contacts.push({ email });
    if (phone) contacts.push({ phone });
    if (contacts.length === 0) return Promise.resolve(null);

    return Customer.findOne({ $or: contacts, status: { $ne: "archived" } })
      .sort({ updatedAt: -1 })
      .exec();
  }

  async create(
    input: CustomerCreateInput,
    session?: ClientSession,
  ) {
    const customer = new Customer(input);
    await customer.save({ session });
    return customer;
  }
}

export const customerRepository = new CustomerRepository();
