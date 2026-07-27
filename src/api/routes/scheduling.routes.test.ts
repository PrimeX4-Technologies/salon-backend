import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "../middlewares/error.middleware.js";
import { employeeSchedulingRouter } from "./scheduling.routes.js";

const createCompositionTestApp = () => {
  const app = express();
  app.use("/employees", employeeSchedulingRouter);
  app.get("/employees/:employeeId", (req, res) => {
    res.status(200).json({ employeeId: req.params.employeeId });
  });
  app.use(errorHandler);
  return app;
};

describe("employee scheduling route composition", () => {
  it("does not apply employee-only guards to admin employee-profile routes", async () => {
    const employeeId = "507f1f77bcf86cd799439011";
    const response = await request(createCompositionTestApp()).get(
      `/employees/${employeeId}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ employeeId });
  });

  it("keeps employee authentication on the self-service time-off subtree", async () => {
    const response = await request(createCompositionTestApp()).get(
      "/employees/me/time-off",
    );

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
});
