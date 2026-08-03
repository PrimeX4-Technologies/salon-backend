import { Router } from "express";

import {
  changePassword,
  confirmEmail,
  forgotPassword,
  getMe,
  googleLogin,
  listSessions,
  login,
  logout,
  logoutAll,
  refresh,
  registerCustomer,
  requestEmailVerification,
  resetPassword,
  revokeSession,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  authRateLimiter,
  authRefreshRateLimiter,
} from "../middlewares/rate-limit.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  changePasswordSchema,
  confirmEmailSchema,
  customerRegistrationSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  refreshTokenSchema,
  resetPasswordSchema,
  sessionParamSchema,
} from "../../validation/auth.schemas.js";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});

router.post(
  "/register/customer",
  authRateLimiter,
  validate({ body: customerRegistrationSchema }),
  registerCustomer,
);
router.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  login,
);
router.post(
  "/google",
  authRateLimiter,
  validate({ body: googleLoginSchema }),
  googleLogin,
);
router.post(
  "/refresh",
  authRefreshRateLimiter,
  validate({ body: refreshTokenSchema }),
  refresh,
);
router.post("/logout", authenticate, logout);
router.post("/logout-all", authenticate, logoutAll);
router.patch(
  "/password",
  authenticate,
  authRateLimiter,
  validate({ body: changePasswordSchema }),
  changePassword,
);
router.get("/me", authenticate, getMe);

router.post(
  "/password/forgot",
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPassword,
);
router.post(
  "/password/reset",
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  resetPassword,
);
router.post(
  "/email-verification/request",
  authenticate,
  authRateLimiter,
  requestEmailVerification,
);
router.post(
  "/email-verification/confirm",
  authRateLimiter,
  validate({ body: confirmEmailSchema }),
  confirmEmail,
);
router.get("/sessions", authenticate, listSessions);
router.delete(
  "/sessions/:sessionId",
  authenticate,
  validate({ params: sessionParamSchema }),
  revokeSession,
);

export default router;
