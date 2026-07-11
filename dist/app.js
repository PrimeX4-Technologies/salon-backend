import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./api/middlewares/error.middleware.js";
import apiRouter from "./api/routes/index.js";
import { config } from "./config/env.js";
import { isDBReady } from "./config/database.js";
import { redisService } from "./services/redis.service.js";
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.TRUST_PROXY);
app.use(helmet());
app.use(cors({
    origin: config.CORS_ORIGIN === "*" ? "*" : config.CORS_ORIGIN.split(",").map((item) => item.trim()),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
}));
app.use(express.json({ limit: config.REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: config.REQUEST_BODY_LIMIT }));
app.use((req, res, next) => {
    const requestId = req.header("x-request-id") || randomUUID();
    res.setHeader("x-request-id", requestId);
    next();
});
app.get("/health", (_req, res) => {
    res.status(200).json({ success: true, status: "ok" });
});
app.get("/ready", (_req, res) => {
    const dependencies = {
        mongodb: isDBReady(),
        redis: redisService.isReady(),
    };
    const ready = Object.values(dependencies).every(Boolean);
    res.status(ready ? 200 : 503).json({
        success: ready,
        status: ready ? "ready" : "not_ready",
        dependencies,
    });
});
app.use("/api/v1", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
export default app;
