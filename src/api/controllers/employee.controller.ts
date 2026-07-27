import type { Request, Response } from "express";

import type { IStaffAccess } from "../../models/access/StaffAccess.js";
import {
  employeeService,
  type StaffScope,
} from "../../services/employee.service.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from "../../utils/httpResponse.js";
import type {
  AdminListQuery,
  CreateAdminBody,
  CreateEmployeeBody,
  CreateLevelBody,
  CreateSkillBody,
  EmployeeListQuery,
  ProvisionEmployeeAccountBody,
  StaffAccessInput,
  UpdateAdminBody,
  UpdateEmployeeBody,
  UpdateLevelBody,
  UpdateMyEmployeeProfileBody,
  UpdateSkillBody,
  UpsertEmployeeServiceBody,
  UpsertEmployeeSkillBody,
} from "../../validation/staff.schemas.js";
import {
  getAuditContext,
  getValidatedParam,
} from "./request-audit-context.js";

const requireUserId = (req: Request): string => {
  if (!req.auth) {
    throw ApiError.unauthorized(
      "Authentication is required",
      "AUTHENTICATION_REQUIRED",
    );
  }
  return req.auth.userId;
};

const getStaffScope = (res: Response): StaffScope => {
  const access = res.locals.staffAccess as IStaffAccess | undefined;
  if (!access) {
    throw ApiError.forbidden(
      "Active staff access is required",
      "STAFF_ACCESS_REQUIRED",
    );
  }
  return {
    allBranches: access.allBranches,
    branchIds: access.branchIds.map((id) => id.toString()),
    permissions: [...access.permissions],
  };
};

export const listEmployees = catchAsync(async (req, res) => {
  const result = await employeeService.list(
    req.query as unknown as EmployeeListQuery,
    getStaffScope(res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getEmployee = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.getById(
      getValidatedParam(req, "employeeId"),
      getStaffScope(res),
    ),
  );
});

export const getMyEmployeeProfile = catchAsync(async (req, res) => {
  sendSuccess(res, await employeeService.getMyProfile(requireUserId(req)));
});

export const updateMyEmployeeProfile = catchAsync(async (req, res) => {
  const employee = await employeeService.updateMyProfile(
    requireUserId(req),
    req.body as UpdateMyEmployeeProfileBody,
    getAuditContext(req, res),
  );
  sendSuccess(res, employee);
});

export const createEmployee = catchAsync(async (req, res) => {
  const employee = await employeeService.create(
    req.body as CreateEmployeeBody,
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendCreated(res, employee);
});

export const updateEmployee = catchAsync(async (req, res) => {
  const employee = await employeeService.update(
    getValidatedParam(req, "employeeId"),
    req.body as UpdateEmployeeBody,
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendSuccess(res, employee);
});

export const provisionEmployeeAccount = catchAsync(async (req, res) => {
  const employee = await employeeService.provisionAccount(
    getValidatedParam(req, "employeeId"),
    req.body as ProvisionEmployeeAccountBody,
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendCreated(res, employee);
});

export const terminateEmployee = catchAsync(async (req, res) => {
  await employeeService.terminate(
    getValidatedParam(req, "employeeId"),
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendNoContent(res);
});

export const getEmployeeAccess = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.getAccess(
      getValidatedParam(req, "employeeId"),
      getStaffScope(res),
    ),
  );
});

export const updateEmployeeAccess = catchAsync(async (req, res) => {
  const access = await employeeService.updateAccess(
    getValidatedParam(req, "employeeId"),
    req.body as StaffAccessInput,
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendSuccess(res, access);
});

export const listEmployeeSkills = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.listSkills(
      getValidatedParam(req, "employeeId"),
      getStaffScope(res),
    ),
  );
});

export const upsertEmployeeSkill = catchAsync(async (req, res) => {
  const assignment = await employeeService.upsertSkill(
    getValidatedParam(req, "employeeId"),
    getValidatedParam(req, "skillId"),
    req.body as UpsertEmployeeSkillBody,
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendSuccess(res, assignment);
});

export const removeEmployeeSkill = catchAsync(async (req, res) => {
  await employeeService.removeSkill(
    getValidatedParam(req, "employeeId"),
    getValidatedParam(req, "skillId"),
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendNoContent(res);
});

export const listEmployeeServices = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.listServices(
      getValidatedParam(req, "employeeId"),
      typeof req.query.branchId === "string"
        ? req.query.branchId
        : undefined,
      getStaffScope(res),
    ),
  );
});

export const upsertEmployeeService = catchAsync(async (req, res) => {
  const assignment = await employeeService.upsertService(
    getValidatedParam(req, "employeeId"),
    getValidatedParam(req, "serviceId"),
    getValidatedParam(req, "branchId"),
    req.body as UpsertEmployeeServiceBody,
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendSuccess(res, assignment);
});

export const removeEmployeeService = catchAsync(async (req, res) => {
  await employeeService.removeService(
    getValidatedParam(req, "employeeId"),
    getValidatedParam(req, "serviceId"),
    getValidatedParam(req, "branchId"),
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendNoContent(res);
});

export const listSkills = catchAsync(async (req, res) => {
  const query = req.query as unknown as { activeOnly: boolean };
  sendSuccess(
    res,
    await employeeService.listAllSkills(query.activeOnly),
  );
});

export const createSkill = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await employeeService.createSkill(
      req.body as CreateSkillBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const updateSkill = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.updateSkill(
      getValidatedParam(req, "skillId"),
      req.body as UpdateSkillBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const deactivateSkill = catchAsync(async (req, res) => {
  await employeeService.deactivateSkill(
    getValidatedParam(req, "skillId"),
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendNoContent(res);
});

export const listEmployeeLevels = catchAsync(async (req, res) => {
  const query = req.query as unknown as { activeOnly: boolean };
  sendSuccess(
    res,
    await employeeService.listLevels(query.activeOnly),
  );
});

export const createEmployeeLevel = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await employeeService.createLevel(
      req.body as CreateLevelBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const updateEmployeeLevel = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.updateLevel(
      getValidatedParam(req, "levelId"),
      req.body as UpdateLevelBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const deactivateEmployeeLevel = catchAsync(async (req, res) => {
  await employeeService.deactivateLevel(
    getValidatedParam(req, "levelId"),
    getAuditContext(req, res),
    getStaffScope(res),
  );
  sendNoContent(res);
});

export const listAdmins = catchAsync(async (req, res) => {
  const result = await employeeService.listAdmins(
    req.query as unknown as AdminListQuery,
    getStaffScope(res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getAdmin = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.getAdmin(
      getValidatedParam(req, "adminId"),
      getStaffScope(res),
    ),
  );
});

export const createAdmin = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await employeeService.createAdmin(
      req.body as CreateAdminBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const updateAdmin = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.updateAdmin(
      getValidatedParam(req, "adminId"),
      req.body as UpdateAdminBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const updateAdminAccess = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await employeeService.updateAdminAccess(
      getValidatedParam(req, "adminId"),
      req.body as StaffAccessInput,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});
