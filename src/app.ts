import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";

import { errorHandler, notFoundHandler } from "./api/middlewares/error.middleware.js";
import { apiRateLimiter } from "./api/middlewares/rate-limit.middleware.js";
import { requestContext } from "./api/middlewares/request-context.middleware.js";
import { rejectUnsafeKeys } from "./api/middlewares/request-safety.middleware.js";
import apiRouter from "./api/routes/index.js";
import { config } from "./config/env.js";
import { isDBReady } from "./config/database.js";
import openApiRouter from "./docs/openapi.routes.js";
import { redisService } from "./services/redis.service.js";

const app = express();
const allowedOrigins = config.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowsAnyOrigin = allowedOrigins.includes("*");

app.disable("x-powered-by");
app.set("trust proxy", config.TRUST_PROXY);
app.set("query parser", "simple");

app.use(requestContext);
app.use(compression());
app.use(
  cors({
    origin: allowsAnyOrigin
      ? "*"
      : (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
          }
          callback(null, false);
        },
    credentials: !allowsAnyOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "If-Match",
      "X-CSRF-Token",
      "X-Request-Id",
    ],
    exposedHeaders: [
      "ETag",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After",
      "X-Request-Id",
    ],
    maxAge: 86_400,
  }),
);
app.use(openApiRouter);
app.use(helmet());
app.use(
  "/api/v1/webhooks/payments",
  express.raw({
    limit: config.REQUEST_BODY_LIMIT,
    type: "*/*",
  }),
  (req, _res, next) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = Buffer.from(req.body);
    }
    next();
  },
);
app.use(
  express.json({
    limit: config.REQUEST_BODY_LIMIT,
    type: ["application/json", "application/*+json"],
  }),
);
app.use(express.urlencoded({ extended: false, limit: config.REQUEST_BODY_LIMIT }));
app.use(cookieParser());
app.use(rejectUnsafeKeys);

const healthHandler: express.RequestHandler = (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    success: true,
    status: "ok",
    timeZone: config.TIME_ZONE,
    uptimeSeconds: Math.floor(process.uptime()),
  });
};

const readinessHandler: express.RequestHandler = (_req, res) => {
  const dependencies = {
    mongodb: isDBReady(),
    redis: redisService.isReady(),
  };
  const ready = Object.values(dependencies).every(Boolean);

  res.setHeader("Cache-Control", "no-store");
  res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "ready" : "not_ready",
    dependencies,
  });
};

app.get(["/health", "/healthz"], healthHandler);
app.get(["/ready", "/readyz"], readinessHandler);

app.use("/api/v1", apiRateLimiter, apiRouter);
app.use("/api/v1", openApiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
