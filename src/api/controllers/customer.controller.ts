import type { Request } from "express";

import { customerService } from "../../services/customer.service.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from "../../utils/httpResponse.js";
import type {
  CreateCustomerBody,
  CustomerListQuery,
  UpdateCustomerBody,
  UpdateMyCustomerProfileBody,
} from "../../validation/customer.schemas.js";
import {
  getAuditContext,
  getValidatedParam,
} from "./request-audit-context.js";

const requireUserId = (req: Request): string => {
  if (!req.auth) {
    throw ApiError.unauthorized(
      "Authentication is required",
      "AUTHENTICATION_REQUIRED",
    );
  }
  return req.auth.userId;
};

export const getMyCustomerProfile = catchAsync(async (req, res) => {
  const profile = await customerService.getMyProfile(requireUserId(req));
  sendSuccess(res, profile);
});

export const updateMyCustomerProfile = catchAsync(async (req, res) => {
  const profile = await customerService.updateMyProfile(
    requireUserId(req),
    req.body as UpdateMyCustomerProfileBody,
    getAuditContext(req, res),
  );
  sendSuccess(res, profile);
});

export const listCustomers = catchAsync(async (req, res) => {
  const result = await customerService.list(
    req.query as unknown as CustomerListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getCustomer = catchAsync(async (req, res) => {
  const customer = await customerService.getById(
    getValidatedParam(req, "customerId"),
  );
  sendSuccess(res, customer);
});

export const createCustomer = catchAsync(async (req, res) => {
  const customer = await customerService.create(
    req.body as CreateCustomerBody,
    getAuditContext(req, res),
  );
  sendCreated(res, customer);
});

export const updateCustomer = catchAsync(async (req, res) => {
  const customer = await customerService.update(
    getValidatedParam(req, "customerId"),
    req.body as UpdateCustomerBody,
    getAuditContext(req, res),
  );
  sendSuccess(res, customer);
});

export const archiveCustomer = catchAsync(async (req, res) => {
  await customerService.archive(
    getValidatedParam(req, "customerId"),
    getAuditContext(req, res),
  );
  sendNoContent(res);
});
