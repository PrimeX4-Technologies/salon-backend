import { Router } from "express";

import {
  createEmployee,
  getEmployee,
  getEmployeeAccess,
  getMyEmployeeProfile,
  listEmployeeServices,
  listEmployeeSkills,
  listEmployees,
  provisionEmployeeAccount,
  removeEmployeeService,
  removeEmployeeSkill,
  terminateEmployee,
  updateEmployee,
  updateEmployeeAccess,
  updateMyEmployeeProfile,
  upsertEmployeeService,
  upsertEmployeeSkill,
} from "../controllers/employee.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  authorizeRoles,
  requireBranchAccess,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createEmployeeBodySchema,
  employeeIdParamsSchema,
  employeeListQuerySchema,
  provisionEmployeeAccountBodySchema,
  employeeServiceListQuerySchema,
  employeeServiceParamsSchema,
  employeeSkillParamsSchema,
  staffAccessBodySchema,
  updateEmployeeBodySchema,
  updateMyEmployeeProfileBodySchema,
  upsertEmployeeServiceBodySchema,
  upsertEmployeeSkillBodySchema,
} from "../../validation/staff.schemas.js";

const router = Router();

router.get(
  "/me",
  authenticate,
  authorizeRoles("employee"),
  requirePermissions(),
  getMyEmployeeProfile,
);
router.patch(
  "/me",
  authenticate,
  authorizeRoles("employee"),
  requirePermissions(),
  validate({ body: updateMyEmployeeProfileBodySchema }),
  updateMyEmployeeProfile,
);

router.use(
  authenticate,
  authorizeRoles("admin", "employee"),
  requirePermissions("manage_staff"),
);

router.get(
  "/",
  validate({ query: employeeListQuerySchema }),
  listEmployees,
);
router.post(
  "/",
  validate({ body: createEmployeeBodySchema }),
  createEmployee,
);
router.get(
  "/:employeeId",
  validate({ params: employeeIdParamsSchema }),
  getEmployee,
);
router.patch(
  "/:employeeId",
  validate({
    params: employeeIdParamsSchema,
    body: updateEmployeeBodySchema,
  }),
  updateEmployee,
);
router.post(
  "/:employeeId/account",
  validate({
    params: employeeIdParamsSchema,
    body: provisionEmployeeAccountBodySchema,
  }),
  provisionEmployeeAccount,
);
router.delete(
  "/:employeeId",
  validate({ params: employeeIdParamsSchema }),
  terminateEmployee,
);

router.get(
  "/:employeeId/access",
  validate({ params: employeeIdParamsSchema }),
  getEmployeeAccess,
);
router.put(
  "/:employeeId/access",
  validate({
    params: employeeIdParamsSchema,
    body: staffAccessBodySchema,
  }),
  updateEmployeeAccess,
);

router.get(
  "/:employeeId/skills",
  validate({ params: employeeIdParamsSchema }),
  listEmployeeSkills,
);
router.put(
  "/:employeeId/skills/:skillId",
  validate({
    params: employeeSkillParamsSchema,
    body: upsertEmployeeSkillBodySchema,
  }),
  upsertEmployeeSkill,
);
router.delete(
  "/:employeeId/skills/:skillId",
  validate({ params: employeeSkillParamsSchema }),
  removeEmployeeSkill,
);

router.get(
  "/:employeeId/services",
  validate({
    params: employeeIdParamsSchema,
    query: employeeServiceListQuerySchema,
  }),
  listEmployeeServices,
);
router.put(
  "/:employeeId/services/:serviceId/branches/:branchId",
  validate({
    params: employeeServiceParamsSchema,
    body: upsertEmployeeServiceBodySchema,
  }),
  requireBranchAccess(),
  upsertEmployeeService,
);
router.delete(
  "/:employeeId/services/:serviceId/branches/:branchId",
  validate({ params: employeeServiceParamsSchema }),
  requireBranchAccess(),
  removeEmployeeService,
);

export default router;
