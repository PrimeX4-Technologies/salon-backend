import type { Request, Response } from "express";

import type {
  BranchCreateInput,
  BranchHoursCreateInput,
  BranchHoursUpdateInput,
  BranchUpdateInput,
  BusinessBootstrapInput,
  BusinessProfileInput,
  BusinessSettingsInput,
} from "../validators/business.validators.js";
import type { IStaffAccess } from "../../models/access/StaffAccess.js";
import { businessService } from "../../services/business.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { getAuditContext } from "./request-audit-context.js";

type BusinessQuery = {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  bookingsEnabled?: boolean;
  branchIds?: string[];
};

type HoursQuery = {
  page?: number;
  limit?: number;
  status?: "draft" | "active" | "archived";
  effectiveOn?: string;
};

const routeParam = (req: Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : value;
};

const validatedBody = <T>(req: Request): T => {
  const body: unknown = req.body;
  return body as T;
};

const validatedQuery = <T>(req: Request): T => {
  const query: unknown = req.query;
  return query as T;
};

const staffScope = (res: Response): Pick<IStaffAccess, "allBranches" | "branchIds"> => {
  const access: unknown = res.locals.staffAccess;
  return access as Pick<IStaffAccess, "allBranches" | "branchIds">;
};

export const getBusinessProfile = catchAsync(async (_req: Request, res: Response) => {
  const profile = await businessService.getBusinessProfile();
  res.status(200).json({ success: true, data: profile });
});

export const updateBusinessProfile = catchAsync(async (req: Request, res: Response) => {
  const profile = await businessService.updateBusinessProfile(
    validatedBody<BusinessProfileInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: profile });
});

export const getBusinessSettings = catchAsync(async (_req: Request, res: Response) => {
  const settings = await businessService.getBusinessSettings();
  res.status(200).json({ success: true, data: settings });
});

export const updateBusinessSettings = catchAsync(async (req: Request, res: Response) => {
  const settings = await businessService.updateBusinessSettings(
    validatedBody<BusinessSettingsInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: settings });
});

export const bootstrapBusiness = catchAsync(async (req: Request, res: Response) => {
  const result = await businessService.bootstrapBusiness(
    validatedBody<BusinessBootstrapInput>(req),
    getAuditContext(req, res),
  );
  res.status(201).json({ success: true, data: result });
});

export const getPublicBusinessOverview = catchAsync(
  async (_req: Request, res: Response) => {
    const overview = await businessService.getBusinessOverview();
    res.status(200).json({ success: true, data: overview });
  },
);

export const listBranches = catchAsync(async (req: Request, res: Response) => {
  const access = staffScope(res);
  const result = await businessService.listBranches(
    {
      ...validatedQuery<BusinessQuery>(req),
      ...(!access?.allBranches
        ? {
            branchIds: access.branchIds.map((branchId) => branchId.toString()),
          }
        : {}),
    },
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const listPublicBranches = catchAsync(async (req: Request, res: Response) => {
  const result = await businessService.listBranches({
    ...validatedQuery<BusinessQuery>(req),
    isActive: true,
  });
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const getBranch = catchAsync(async (req: Request, res: Response) => {
  const branch = await businessService.getBranch(routeParam(req, "branchId"));
  res.status(200).json({ success: true, data: branch });
});

export const getPublicBranch = catchAsync(async (req: Request, res: Response) => {
  const branch = await businessService.getBranch(routeParam(req, "branchId"), true);
  res.status(200).json({ success: true, data: branch });
});

export const createBranch = catchAsync(async (req: Request, res: Response) => {
  const branch = await businessService.createBranch(
    validatedBody<BranchCreateInput>(req),
    getAuditContext(req, res),
  );
  res.status(201).json({ success: true, data: branch });
});

export const updateBranch = catchAsync(async (req: Request, res: Response) => {
  const branch = await businessService.updateBranch(
    routeParam(req, "branchId"),
    validatedBody<BranchUpdateInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: branch });
});

export const archiveBranch = catchAsync(async (req: Request, res: Response) => {
  const branch = await businessService.archiveBranch(
    routeParam(req, "branchId"),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: branch });
});

export const listBranchHours = catchAsync(async (req: Request, res: Response) => {
  const result = await businessService.listBranchHours(
    routeParam(req, "branchId"),
    validatedQuery<HoursQuery>(req),
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const getBranchHours = catchAsync(async (req: Request, res: Response) => {
  const hours = await businessService.getBranchHours(
    routeParam(req, "branchId"),
    routeParam(req, "hoursId"),
  );
  res.status(200).json({ success: true, data: hours });
});

export const getCurrentPublicBranchHours = catchAsync(
  async (req: Request, res: Response) => {
    const result = await businessService.getCurrentBranchHours(
      routeParam(req, "branchId"),
      typeof req.query.effectiveOn === "string" ? req.query.effectiveOn : undefined,
    );
    res.status(200).json({ success: true, data: result });
  },
);

export const createBranchHours = catchAsync(async (req: Request, res: Response) => {
  const hours = await businessService.createBranchHours(
    routeParam(req, "branchId"),
    validatedBody<BranchHoursCreateInput>(req),
    getAuditContext(req, res),
  );
  res.status(201).json({ success: true, data: hours });
});

export const updateBranchHours = catchAsync(async (req: Request, res: Response) => {
  const hours = await businessService.updateBranchHours(
    routeParam(req, "branchId"),
    routeParam(req, "hoursId"),
    validatedBody<BranchHoursUpdateInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: hours });
});

export const archiveBranchHours = catchAsync(async (req: Request, res: Response) => {
  const hours = await businessService.archiveBranchHours(
    routeParam(req, "branchId"),
    routeParam(req, "hoursId"),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: hours });
});

export const businessController = {
  archiveBranch,
  archiveBranchHours,
  bootstrapBusiness,
  createBranch,
  createBranchHours,
  getBranch,
  getBranchHours,
  getBusinessProfile,
  getBusinessSettings,
  getCurrentPublicBranchHours,
  getPublicBranch,
  getPublicBusinessOverview,
  listBranches,
  listBranchHours,
  listPublicBranches,
  updateBranch,
  updateBranchHours,
  updateBusinessProfile,
  updateBusinessSettings,
};

export default businessController;
