import { Router } from "express";

import customerRouter from "./customer.routes.js";
import employeeRouter from "./employee.routes.js";
import {
  adminRouter,
  employeeLevelRouter,
  skillRouter,
} from "./staff.routes.js";

const router = Router();

router.use("/customers", customerRouter);
router.use("/employees", employeeRouter);
router.use("/admins", adminRouter);
router.use("/skills", skillRouter);
router.use("/employee-levels", employeeLevelRouter);

export default router;
