import { Router } from "express";

import { schedulingController } from "../controllers/scheduling.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createRateLimiter } from "../middlewares/rate-limit.middleware.js";
import {
  authorizeRoles,
  requireBranchAccess,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  availabilityQuerySchema,
  bookableResourceListQuerySchema,
  branchIdParamsSchema,
  calendarBlockIdParamsSchema,
  calendarBlockListQuerySchema,
  createBookableResourceBodySchema,
  createCalendarBlockBodySchema,
  createEmployeeScheduleBodySchema,
  createTimeOffBodySchema,
  myTimeOffListQuerySchema,
  resourceIdParamsSchema,
  scheduleCollectionParamsSchema,
  scheduleItemParamsSchema,
  scheduleListQuerySchema,
  staffTimeOffListQuerySchema,
  timeOffDecisionBodySchema,
  timeOffIdParamsSchema,
  updateBookableResourceBodySchema,
  updateCalendarBlockBodySchema,
  updateEmployeeScheduleBodySchema,
} from "../../validation/scheduling.schemas.js";

/**
 * Mount at `/admin/scheduling`.
 */
export const adminSchedulingRouter = Router();

adminSchedulingRouter.use(
  authenticate,
  authorizeRoles("admin", "employee"),
  requirePermissions("manage_schedules"),
);

adminSchedulingRouter.get(
  "/branches/:branchId/employees/:employeeId/schedules",
  validate({
    params: scheduleCollectionParamsSchema,
    query: scheduleListQuerySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.listEmployeeSchedules,
);
adminSchedulingRouter.post(
  "/branches/:branchId/employees/:employeeId/schedules",
  validate({
    params: scheduleCollectionParamsSchema,
    body: createEmployeeScheduleBodySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.createEmployeeSchedule,
);
adminSchedulingRouter.get(
  "/branches/:branchId/employees/:employeeId/schedules/:scheduleId",
  validate({ params: scheduleItemParamsSchema }),
  requireBranchAccess("branchId"),
  schedulingController.getEmployeeSchedule,
);
adminSchedulingRouter.patch(
  "/branches/:branchId/employees/:employeeId/schedules/:scheduleId",
  validate({
    params: scheduleItemParamsSchema,
    body: updateEmployeeScheduleBodySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.updateEmployeeSchedule,
);
adminSchedulingRouter.delete(
  "/branches/:branchId/employees/:employeeId/schedules/:scheduleId",
  validate({ params: scheduleItemParamsSchema }),
  requireBranchAccess("branchId"),
  schedulingController.archiveEmployeeSchedule,
);

adminSchedulingRouter.get(
  "/time-off",
  validate({ query: staffTimeOffListQuerySchema }),
  schedulingController.listStaffTimeOff,
);
adminSchedulingRouter.post(
  "/time-off/:timeOffId/approve",
  validate({
    params: timeOffIdParamsSchema,
    body: timeOffDecisionBodySchema,
  }),
  schedulingController.approveTimeOff,
);
adminSchedulingRouter.post(
  "/time-off/:timeOffId/reject",
  validate({
    params: timeOffIdParamsSchema,
    body: timeOffDecisionBodySchema,
  }),
  schedulingController.rejectTimeOff,
);
adminSchedulingRouter.post(
  "/time-off/:timeOffId/cancel",
  validate({
    params: timeOffIdParamsSchema,
    body: timeOffDecisionBodySchema,
  }),
  schedulingController.cancelStaffTimeOff,
);

adminSchedulingRouter.get(
  "/branches/:branchId/calendar-blocks",
  validate({
    params: branchIdParamsSchema,
    query: calendarBlockListQuerySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.listCalendarBlocks,
);
adminSchedulingRouter.post(
  "/branches/:branchId/calendar-blocks",
  validate({
    params: branchIdParamsSchema,
    body: createCalendarBlockBodySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.createCalendarBlock,
);
adminSchedulingRouter.get(
  "/branches/:branchId/calendar-blocks/:blockId",
  validate({ params: calendarBlockIdParamsSchema }),
  requireBranchAccess("branchId"),
  schedulingController.getCalendarBlock,
);
adminSchedulingRouter.patch(
  "/branches/:branchId/calendar-blocks/:blockId",
  validate({
    params: calendarBlockIdParamsSchema,
    body: updateCalendarBlockBodySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.updateCalendarBlock,
);
adminSchedulingRouter.delete(
  "/branches/:branchId/calendar-blocks/:blockId",
  validate({ params: calendarBlockIdParamsSchema }),
  requireBranchAccess("branchId"),
  schedulingController.cancelCalendarBlock,
);

adminSchedulingRouter.get(
  "/branches/:branchId/resources",
  validate({
    params: branchIdParamsSchema,
    query: bookableResourceListQuerySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.listBookableResources,
);
adminSchedulingRouter.post(
  "/branches/:branchId/resources",
  validate({
    params: branchIdParamsSchema,
    body: createBookableResourceBodySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.createBookableResource,
);
adminSchedulingRouter.get(
  "/branches/:branchId/resources/:resourceId",
  validate({ params: resourceIdParamsSchema }),
  requireBranchAccess("branchId"),
  schedulingController.getBookableResource,
);
adminSchedulingRouter.patch(
  "/branches/:branchId/resources/:resourceId",
  validate({
    params: resourceIdParamsSchema,
    body: updateBookableResourceBodySchema,
  }),
  requireBranchAccess("branchId"),
  schedulingController.updateBookableResource,
);
adminSchedulingRouter.delete(
  "/branches/:branchId/resources/:resourceId",
  validate({ params: resourceIdParamsSchema }),
  requireBranchAccess("branchId"),
  schedulingController.deactivateBookableResource,
);

/**
 * Mount at `/employees` alongside the employee-profile router.
 */
export const employeeSchedulingRouter = Router();

employeeSchedulingRouter.use(
  "/me/time-off",
  authenticate,
  authorizeRoles("employee"),
  requirePermissions(),
);
employeeSchedulingRouter.get(
  "/me/time-off",
  validate({ query: myTimeOffListQuerySchema }),
  schedulingController.listMyTimeOff,
);
employeeSchedulingRouter.post(
  "/me/time-off",
  validate({ body: createTimeOffBodySchema }),
  schedulingController.requestMyTimeOff,
);
employeeSchedulingRouter.post(
  "/me/time-off/:timeOffId/cancel",
  validate({ params: timeOffIdParamsSchema }),
  schedulingController.cancelMyTimeOff,
);

/**
 * Mount at `/public`.
 */
export const publicSchedulingRouter = Router();

const publicAvailabilityRateLimiter = createRateLimiter({
  namespace: "public-availability",
  limit: 120,
  windowSeconds: 60,
});

publicSchedulingRouter.get(
  "/availability",
  publicAvailabilityRateLimiter,
  validate({ query: availabilityQuerySchema }),
  schedulingController.listPublicAvailability,
);

export default adminSchedulingRouter;
