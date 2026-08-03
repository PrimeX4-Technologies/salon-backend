import type { Request, Response } from "express";

import type { IStaffAccess } from "../../models/access/StaffAccess.js";
import { availabilityService } from "../../services/availability.service.js";
import {
  schedulingService,
  type SchedulingStaffScope,
} from "../../services/scheduling.service.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/httpResponse.js";
import type {
  AvailabilityQuery,
  BookableResourceListQuery,
  CalendarBlockListQuery,
  CreateBookableResourceBody,
  CreateCalendarBlockBody,
  CreateEmployeeScheduleBody,
  CreateTimeOffBody,
  MyTimeOffListQuery,
  ScheduleListQuery,
  StaffTimeOffListQuery,
  TimeOffDecisionBody,
  UpdateBookableResourceBody,
  UpdateCalendarBlockBody,
  UpdateEmployeeScheduleBody,
} from "../../validation/scheduling.schemas.js";
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

const getStaffScope = (res: Response): SchedulingStaffScope => {
  const access = res.locals.staffAccess as IStaffAccess | undefined;
  if (!access) {
    throw ApiError.forbidden(
      "Active staff access is required",
      "STAFF_ACCESS_REQUIRED",
    );
  }
  return {
    allBranches: access.allBranches,
    branchIds: access.branchIds.map((branchId) => branchId.toString()),
  };
};

export const listEmployeeSchedules = catchAsync(async (req, res) => {
  const result = await schedulingService.listEmployeeSchedules(
    getValidatedParam(req, "branchId"),
    getValidatedParam(req, "employeeId"),
    req.query as unknown as ScheduleListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getEmployeeSchedule = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.getEmployeeSchedule(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "employeeId"),
      getValidatedParam(req, "scheduleId"),
    ),
  );
});

export const createEmployeeSchedule = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await schedulingService.createEmployeeSchedule(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "employeeId"),
      req.body as CreateEmployeeScheduleBody,
      getAuditContext(req, res),
    ),
  );
});

export const updateEmployeeSchedule = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.updateEmployeeSchedule(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "employeeId"),
      getValidatedParam(req, "scheduleId"),
      req.body as UpdateEmployeeScheduleBody,
      getAuditContext(req, res),
    ),
  );
});

export const archiveEmployeeSchedule = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.archiveEmployeeSchedule(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "employeeId"),
      getValidatedParam(req, "scheduleId"),
      getAuditContext(req, res),
    ),
  );
});

export const listMyTimeOff = catchAsync(async (req, res) => {
  const result = await schedulingService.listMyTimeOff(
    requireUserId(req),
    req.query as unknown as MyTimeOffListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const requestMyTimeOff = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await schedulingService.requestMyTimeOff(
      requireUserId(req),
      req.body as CreateTimeOffBody,
      getAuditContext(req, res),
    ),
  );
});

export const cancelMyTimeOff = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.cancelMyTimeOff(
      requireUserId(req),
      getValidatedParam(req, "timeOffId"),
      getAuditContext(req, res),
    ),
  );
});

export const listStaffTimeOff = catchAsync(async (req, res) => {
  const result = await schedulingService.listStaffTimeOff(
    req.query as unknown as StaffTimeOffListQuery,
    getStaffScope(res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const approveTimeOff = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.approveTimeOff(
      getValidatedParam(req, "timeOffId"),
      req.body as TimeOffDecisionBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const rejectTimeOff = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.rejectTimeOff(
      getValidatedParam(req, "timeOffId"),
      req.body as TimeOffDecisionBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const cancelStaffTimeOff = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.cancelStaffTimeOff(
      getValidatedParam(req, "timeOffId"),
      req.body as TimeOffDecisionBody,
      getAuditContext(req, res),
      getStaffScope(res),
    ),
  );
});

export const listCalendarBlocks = catchAsync(async (req, res) => {
  const result = await schedulingService.listCalendarBlocks(
    getValidatedParam(req, "branchId"),
    req.query as unknown as CalendarBlockListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getCalendarBlock = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.getCalendarBlock(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "blockId"),
    ),
  );
});

export const createCalendarBlock = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await schedulingService.createCalendarBlock(
      getValidatedParam(req, "branchId"),
      req.body as CreateCalendarBlockBody,
      getAuditContext(req, res),
    ),
  );
});

export const updateCalendarBlock = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.updateCalendarBlock(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "blockId"),
      req.body as UpdateCalendarBlockBody,
      getAuditContext(req, res),
    ),
  );
});

export const cancelCalendarBlock = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.cancelCalendarBlock(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "blockId"),
      getAuditContext(req, res),
    ),
  );
});

export const listBookableResources = catchAsync(async (req, res) => {
  const result = await schedulingService.listBookableResources(
    getValidatedParam(req, "branchId"),
    req.query as unknown as BookableResourceListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getBookableResource = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.getBookableResource(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "resourceId"),
    ),
  );
});

export const createBookableResource = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await schedulingService.createBookableResource(
      getValidatedParam(req, "branchId"),
      req.body as CreateBookableResourceBody,
      getAuditContext(req, res),
    ),
  );
});

export const updateBookableResource = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.updateBookableResource(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "resourceId"),
      req.body as UpdateBookableResourceBody,
      getAuditContext(req, res),
    ),
  );
});

export const deactivateBookableResource = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await schedulingService.deactivateBookableResource(
      getValidatedParam(req, "branchId"),
      getValidatedParam(req, "resourceId"),
      getAuditContext(req, res),
    ),
  );
});

export const listPublicAvailability = catchAsync(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  sendSuccess(
    res,
    await availabilityService.listPublicAvailability(
      req.query as unknown as AvailabilityQuery,
    ),
  );
});

export const schedulingController = {
  approveTimeOff,
  archiveEmployeeSchedule,
  cancelCalendarBlock,
  cancelMyTimeOff,
  cancelStaffTimeOff,
  createBookableResource,
  createCalendarBlock,
  createEmployeeSchedule,
  deactivateBookableResource,
  getBookableResource,
  getCalendarBlock,
  getEmployeeSchedule,
  listBookableResources,
  listCalendarBlocks,
  listEmployeeSchedules,
  listMyTimeOff,
  listPublicAvailability,
  listStaffTimeOff,
  rejectTimeOff,
  requestMyTimeOff,
  updateBookableResource,
  updateCalendarBlock,
  updateEmployeeSchedule,
};
