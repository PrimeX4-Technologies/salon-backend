import { Router } from "express";

import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  getMyCustomerProfile,
  listCustomers,
  updateCustomer,
  updateMyCustomerProfile,
} from "../controllers/customer.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  authorizeRoles,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createCustomerBodySchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  updateCustomerBodySchema,
  updateMyCustomerProfileBodySchema,
} from "../../validation/customer.schemas.js";

const router = Router();

router.get(
  "/me",
  authenticate,
  authorizeRoles("customer"),
  getMyCustomerProfile,
);
router.patch(
  "/me",
  authenticate,
  authorizeRoles("customer"),
  validate({ body: updateMyCustomerProfileBodySchema }),
  updateMyCustomerProfile,
);

router.use(authenticate, authorizeRoles("admin", "employee"));

router.get(
  "/",
  requirePermissions("view_customers"),
  validate({ query: customerListQuerySchema }),
  listCustomers,
);
router.post(
  "/",
  requirePermissions("manage_customers"),
  validate({ body: createCustomerBodySchema }),
  createCustomer,
);
router.get(
  "/:customerId",
  requirePermissions("view_customers"),
  validate({ params: customerIdParamsSchema }),
  getCustomer,
);
router.patch(
  "/:customerId",
  requirePermissions("manage_customers"),
  validate({
    params: customerIdParamsSchema,
    body: updateCustomerBodySchema,
  }),
  updateCustomer,
);
router.delete(
  "/:customerId",
  requirePermissions("manage_customers"),
  validate({ params: customerIdParamsSchema }),
  archiveCustomer,
);

export default router;
