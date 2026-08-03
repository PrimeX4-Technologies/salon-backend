import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "../middlewares/error.middleware.js";
import { employeeSelfBookingRouter } from "./booking.routes.js";

const createRouteCompositionApp = () => {
  const app = express();
  app.use("/employees", employeeSelfBookingRouter);
  app.get("/employees/:employeeId", (req, res) => {
    res.status(200).json({ route: "people", employeeId: req.params.employeeId });
  });
  app.use(errorHandler);
  return app;
};

describe("employee booking route composition", () => {
  it("allows unrelated employee CRUD routes to fall through", async () => {
    const response = await request(createRouteCompositionApp()).get(
      "/employees/507f1f77bcf86cd799439011",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      route: "people",
      employeeId: "507f1f77bcf86cd799439011",
    });
  });

  it("guards only the employee self-booking subtree", async () => {
    const response = await request(createRouteCompositionApp()).get(
      "/employees/me/bookings",
    );

    expect(response.status).toBe(401);
    expect(response.text).toContain("AUTHENTICATION_REQUIRED");
  });
});
