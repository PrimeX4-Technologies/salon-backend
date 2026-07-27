import type { ClientSession, QueryFilter, Types } from "mongoose";

import StaffAccess, {
  type IStaffAccess,
} from "../models/access/StaffAccess.js";
import User, { type IUser } from "../models/auth/User.js";
import Branch from "../models/business/Branch.js";
import BranchService from "../models/catalog/BranchService.js";
import Service from "../models/catalog/Service.js";
import Employee, {
  type IEmployee,
} from "../models/staff/Employee.js";
import EmployeeLevel from "../models/staff/EmployeeLevel.js";
import EmployeeService, {
  type IEmployeeService,
} from "../models/staff/EmployeeService.js";
import EmployeeSkill, {
  type IEmployeeSkill,
} from "../models/staff/EmployeeSkill.js";
import Skill from "../models/staff/Skill.js";

export interface EmployeeListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: IEmployee["status"];
  employmentType?: IEmployee["employmentType"];
  branchId?: Types.ObjectId;
  levelId?: Types.ObjectId;
  isBookable?: boolean;
  allowedBranchIds?: Types.ObjectId[];
}

export interface EmployeeListResult {
  items: Array<Record<string, unknown>>;
  total: number;
}

export interface AdminListFilters {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class EmployeeRepository {
  async list(filters: EmployeeListFilters): Promise<EmployeeListResult> {
    const query: QueryFilter<IEmployee> = {};

    if (filters.status) query.status = filters.status;
    if (filters.employmentType) query.employmentType = filters.employmentType;
    if (filters.branchId) query.branchIds = filters.branchId;
    if (filters.allowedBranchIds) {
      query.branchIds = filters.branchId
        ? filters.branchId
        : { $in: filters.allowedBranchIds };
      if (filters.allowedBranchIds.length === 0) {
        query._id = { $exists: false };
      }
    }
    if (filters.levelId) query.levelId = filters.levelId;
    if (filters.isBookable !== undefined) {
      query.isBookable = filters.isBookable;
    }
    if (filters.search) {
      const expression = new RegExp(escapeRegExp(filters.search), "i");
      query.$or = [
        { employeeCode: expression },
        { name: expression },
        { title: expression },
        { workEmail: expression },
        { workPhone: expression },
      ];
    }

    const skip = (filters.page - 1) * filters.limit;
    const [items, total] = await Promise.all([
      Employee.find(query)
        .populate(
          "userId",
          "name email phone role avatarUrl isActive lastLoginAt",
        )
        .populate("levelId", "name code rank")
        .populate("branchIds", "name code isActive")
        .populate("primaryBranchId", "name code isActive")
        .sort({ name: 1, _id: 1 })
        .skip(skip)
        .limit(filters.limit)
        .lean()
        .exec(),
      Employee.countDocuments(query).exec(),
    ]);

    return {
      items: items as unknown as Array<Record<string, unknown>>,
      total,
    };
  }

  findById(id: Types.ObjectId) {
    return Employee.findById(id)
      .populate("levelId", "name code rank")
      .populate("branchIds", "name code isActive bookingsEnabled")
      .populate("primaryBranchId", "name code isActive bookingsEnabled")
      .exec();
  }

  findDocumentById(id: Types.ObjectId, session?: ClientSession) {
    return Employee.findById(id).session(session ?? null).exec();
  }

  findByUserId(userId: Types.ObjectId) {
    return Employee.findOne({ userId })
      .populate("levelId", "name code rank")
      .populate("branchIds", "name code isActive bookingsEnabled")
      .populate("primaryBranchId", "name code isActive bookingsEnabled")
      .exec();
  }

  findByEmployeeCode(employeeCode: string) {
    return Employee.findOne({ employeeCode }).exec();
  }

  async create(
    input: Omit<IEmployee, "createdAt" | "updatedAt">,
    session?: ClientSession,
  ) {
    const employee = new Employee(input);
    await employee.save({ session });
    return employee;
  }

  findAccessByUserId(userId: Types.ObjectId) {
    return StaffAccess.findOne({ userId }).exec();
  }

  findAccessByUserIdInSession(
    userId: Types.ObjectId,
    session?: ClientSession,
  ) {
    return StaffAccess.findOne({ userId }).session(session ?? null).exec();
  }

  async createAccess(
    input: Omit<IStaffAccess, "createdAt" | "updatedAt">,
    session?: ClientSession,
  ) {
    const access = new StaffAccess(input);
    await access.save({ session });
    return access;
  }

  async listAdmins(filters: AdminListFilters) {
    const query: QueryFilter<IUser> = { role: "admin" };
    if (filters.isActive !== undefined) query.isActive = filters.isActive;
    if (filters.search) {
      const expression = new RegExp(escapeRegExp(filters.search), "i");
      query.$or = [
        { name: expression },
        { email: expression },
        { phone: expression },
      ];
    }

    const skip = (filters.page - 1) * filters.limit;
    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ name: 1, _id: 1 })
        .skip(skip)
        .limit(filters.limit)
        .lean()
        .exec(),
      User.countDocuments(query).exec(),
    ]);
    const userIds = users.map((user) => user._id);
    const accessRecords = await StaffAccess.find({ userId: { $in: userIds } })
      .lean()
      .exec();
    const accessByUserId = new Map(
      accessRecords.map((access) => [access.userId.toString(), access]),
    );

    return {
      items: users.map((user) => ({
        ...user,
        access: accessByUserId.get(user._id.toString()) ?? null,
      })),
      total,
    };
  }

  findAdminById(userId: Types.ObjectId) {
    return User.findOne({ _id: userId, role: "admin" }).exec();
  }

  findAdminDocumentById(userId: Types.ObjectId, session?: ClientSession) {
    return User.findOne({ _id: userId, role: "admin" })
      .select("+tokenVersion")
      .session(session ?? null)
      .exec();
  }

  findEmployeeUserDocumentById(
    userId: Types.ObjectId,
    session?: ClientSession,
  ) {
    return User.findOne({ _id: userId, role: "employee" })
      .select("+tokenVersion")
      .session(session ?? null)
      .exec();
  }

  findPublicUserById(userId: Types.ObjectId) {
    return User.findById(userId).exec();
  }

  listSkills(activeOnly = false) {
    return Skill.find(activeOnly ? { isActive: true } : {})
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
  }

  findSkillById(skillId: Types.ObjectId) {
    return Skill.findById(skillId).exec();
  }

  async createSkill(
    input: {
      name: string;
      code: string;
      description?: string;
      isActive: boolean;
    },
    session?: ClientSession,
  ) {
    const skill = new Skill(input);
    await skill.save({ session });
    return skill;
  }

  listEmployeeSkills(employeeId: Types.ObjectId) {
    return EmployeeSkill.find({ employeeId })
      .populate("skillId", "name code description isActive")
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
  }

  findEmployeeSkill(
    employeeId: Types.ObjectId,
    skillId: Types.ObjectId,
  ) {
    return EmployeeSkill.findOne({ employeeId, skillId }).exec();
  }

  async createEmployeeSkill(
    input: Omit<IEmployeeSkill, "createdAt" | "updatedAt">,
    session?: ClientSession,
  ) {
    const employeeSkill = new EmployeeSkill(input);
    await employeeSkill.save({ session });
    return employeeSkill;
  }

  listEmployeeServices(employeeId: Types.ObjectId, branchId?: Types.ObjectId) {
    const query: QueryFilter<IEmployeeService> = { employeeId };
    if (branchId) query.branchId = branchId;

    return EmployeeService.find(query)
      .populate("branchId", "name code isActive bookingsEnabled")
      .populate("serviceId", "name code slug isActive isOnlineBookable")
      .sort({ branchId: 1, serviceId: 1 })
      .lean()
      .exec();
  }

  findEmployeeService(
    employeeId: Types.ObjectId,
    serviceId: Types.ObjectId,
    branchId: Types.ObjectId,
  ) {
    return EmployeeService.findOne({
      employeeId,
      serviceId,
      branchId,
    }).exec();
  }

  async createEmployeeService(
    input: Omit<IEmployeeService, "createdAt" | "updatedAt">,
    session?: ClientSession,
  ) {
    const employeeService = new EmployeeService(input);
    await employeeService.save({ session });
    return employeeService;
  }

  listLevels(activeOnly = false) {
    return EmployeeLevel.find(activeOnly ? { isActive: true } : {})
      .sort({ rank: 1, name: 1, _id: 1 })
      .lean()
      .exec();
  }

  findLevelById(levelId: Types.ObjectId) {
    return EmployeeLevel.findById(levelId).exec();
  }

  async createLevel(
    input: {
      name: string;
      code: string;
      rank: number;
      isActive: boolean;
    },
    session?: ClientSession,
  ) {
    const level = new EmployeeLevel(input);
    await level.save({ session });
    return level;
  }

  branchesExist(branchIds: Types.ObjectId[]) {
    return Branch.countDocuments({
      _id: { $in: branchIds },
      isActive: true,
    }).exec();
  }

  serviceExists(serviceId: Types.ObjectId) {
    return Service.exists({ _id: serviceId, isActive: true }).exec();
  }

  branchServiceExists(branchId: Types.ObjectId, serviceId: Types.ObjectId) {
    return BranchService.exists({
      branchId,
      serviceId,
      isActive: true,
    }).exec();
  }
}

export const employeeRepository = new EmployeeRepository();
