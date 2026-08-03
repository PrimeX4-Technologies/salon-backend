import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "./app.js";

interface ErrorResponseBody {
  error: {
    code: string;
    message?: string;
    requestId?: string;
  };
}

describe("application shell", () => {
  it("reports liveness without requiring dependency connections", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      status: "ok",
      timeZone: "Asia/Colombo",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
  });

  it("reports not-ready while MongoDB and Redis are disconnected", async () => {
    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      status: "not_ready",
      dependencies: {
        mongodb: false,
        redis: false,
      },
    });
  });

  it("serves an OpenAPI document for Swagger and Postman imports", async () => {
    const response = await request(app).get("/openapi.json");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "Salon Booking API",
      },
      paths: {
        "/api/v1/auth/login": {
          post: {
            tags: ["Auth"],
          },
        },
      },
    });
  });

  it("serves Swagger UI with a restrictive documentation CSP", async () => {
    const response = await request(app).get("/docs/");

    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("returns the consistent error contract for unknown routes", async () => {
    const response = await request(app).get("/api/v1/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "ROUTE_NOT_FOUND",
      },
    });
    const body = response.body as unknown as ErrorResponseBody;
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("does not reflect query-string secrets in route errors", async () => {
    const response = await request(app).get(
      "/api/v1/does-not-exist?token=should-not-be-reflected",
    );

    expect(response.status).toBe(404);
    const body = response.body as unknown as ErrorResponseBody;
    expect(body.error.message).not.toContain("should-not-be-reflected");
  });

  it("rejects unsafe Mongo-style object keys before routing", async () => {
    const response = await request(app)
      .post("/api/v1/does-not-exist")
      .send({ profile: { $where: "malicious" } });

    expect(response.status).toBe(400);
    const body = response.body as unknown as ErrorResponseBody;
    expect(body.error.code).toBe("UNSAFE_REQUEST_KEY");
  });

  it("rejects malformed JSON using the public error contract", async () => {
    const response = await request(app)
      .post("/api/v1/does-not-exist")
      .set("Content-Type", "application/json")
      .send('{"broken":');

    expect(response.status).toBe(400);
    const body = response.body as unknown as ErrorResponseBody;
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("reports unsupported JSON charsets as a client error", async () => {
    const response = await request(app)
      .post("/api/v1/does-not-exist")
      .set("Content-Type", "application/json; charset=unsupported")
      .send("{}");

    expect(response.status).toBe(415);
    const body = response.body as unknown as ErrorResponseBody;
    expect(body.error.code).toBe("UNSUPPORTED_REQUEST_BODY");
  });

  it("captures exact payment-webhook bytes for provider verification", async () => {
    const response = await request(app)
      .post("/api/v1/webhooks/payments/unconfigured-provider")
      .set("Content-Type", "text/plain")
      .send("provider-defined-signed-payload");

    expect(response.status).toBe(503);
    const body = response.body as unknown as ErrorResponseBody;
    expect(body.error.code).toBe("PAYMENT_PROVIDER_NOT_CONFIGURED");
  });

  it("allows configured browser origins with credentials", async () => {
    const response = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
