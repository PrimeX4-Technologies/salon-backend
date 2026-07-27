import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../utils/ApiError.js";
import { rejectUnsafeKeys } from "./request-safety.middleware.js";

const response = {} as Response;

describe("request unsafe-key protection", () => {
  it("leaves a captured signed-webhook body for adapter verification", () => {
    const next = vi.fn();
    const request = {
      body: { "$provider.key": "signed-value" },
      params: {},
      query: {},
      rawBody: Buffer.from('{"$provider.key":"signed-value"}'),
    } as unknown as Request;

    rejectUnsafeKeys(request, response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("still rejects unsafe keys in ordinary parsed bodies", () => {
    const next = vi.fn();
    const request = {
      body: { $where: "unsafe" },
      params: {},
      query: {},
    } as unknown as Request;

    rejectUnsafeKeys(request, response, next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
  });

  it("still validates webhook query and route parameters", () => {
    const next = vi.fn();
    const request = {
      body: { "$provider.key": "signed-value" },
      params: {},
      query: { "$where": "unsafe" },
      rawBody: Buffer.from('{"$provider.key":"signed-value"}'),
    } as unknown as Request;

    rejectUnsafeKeys(request, response, next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
  });
});
