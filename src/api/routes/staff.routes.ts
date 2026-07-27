import { Router } from "express";

import {
  createAdmin,
  createEmployeeLevel,
  createSkill,
  deactivateEmployeeLevel,
  deactivateSkill,
  getAdmin,
  listAdmins,
  listEmployeeLevels,
  listSkills,
  updateAdmin,
  updateAdminAccess,
  updateEmployeeLevel,
  updateSkill,
} from "../controllers/employee.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  authorizeRoles,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  activeOnlyQuerySchema,
  adminIdParamsSchema,
  adminListQuerySchema,
  createAdminBodySchema,
  createLevelBodySchema,
  createSkillBodySchema,
  levelIdParamsSchema,
  skillIdParamsSchema,
  staffAccessBodySchema,
  updateAdminBodySchema,
  updateLevelBodySchema,
  updateSkillBodySchema,
} from "../../validation/staff.schemas.js";

export const adminRouter = Router();
adminRouter.use(
  authenticate,
  authorizeRoles("admin"),
  requirePermissions("manage_staff"),
);
adminRouter.get(
  "/",
  validate({ query: adminListQuerySchema }),
  listAdmins,
);
adminRouter.post(
  "/",
  validate({ body: createAdminBodySchema }),
  createAdmin,
);
adminRouter.get(
  "/:adminId",
  validate({ params: adminIdParamsSchema }),
  getAdmin,
);
adminRouter.patch(
  "/:adminId",
  validate({
    params: adminIdParamsSchema,
    body: updateAdminBodySchema,
  }),
  updateAdmin,
);
adminRouter.put(
  "/:adminId/access",
  validate({
    params: adminIdParamsSchema,
    body: staffAccessBodySchema,
  }),
  updateAdminAccess,
);

export const skillRouter = Router();
skillRouter.use(
  authenticate,
  authorizeRoles("admin", "employee"),
  requirePermissions("manage_staff"),
);
skillRouter.get(
  "/",
  validate({ query: activeOnlyQuerySchema }),
  listSkills,
);
skillRouter.post(
  "/",
  validate({ body: createSkillBodySchema }),
  createSkill,
);
skillRouter.patch(
  "/:skillId",
  validate({
    params: skillIdParamsSchema,
    body: updateSkillBodySchema,
  }),
  updateSkill,
);
skillRouter.delete(
  "/:skillId",
  validate({ params: skillIdParamsSchema }),
  deactivateSkill,
);

export const employeeLevelRouter = Router();
employeeLevelRouter.use(
  authenticate,
  authorizeRoles("admin", "employee"),
  requirePermissions("manage_staff"),
);
employeeLevelRouter.get(
  "/",
  validate({ query: activeOnlyQuerySchema }),
  listEmployeeLevels,
);
employeeLevelRouter.post(
  "/",
  validate({ body: createLevelBodySchema }),
  createEmployeeLevel,
);
employeeLevelRouter.patch(
  "/:levelId",
  validate({
    params: levelIdParamsSchema,
    body: updateLevelBodySchema,
  }),
  updateEmployeeLevel,
);
employeeLevelRouter.delete(
  "/:levelId",
  validate({ params: levelIdParamsSchema }),
  deactivateEmployeeLevel,
);
