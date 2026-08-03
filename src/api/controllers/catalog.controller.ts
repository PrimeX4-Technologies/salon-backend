import type { Request, Response } from "express";

import type {
  BranchServiceCreateInput,
  BranchServiceUpdateInput,
  CategoryCreateInput,
  CategoryUpdateInput,
  PackageCreateInput,
  PackageUpdateInput,
  ProductCreateInput,
  ProductUpdateInput,
  ServiceCreateInput,
  ServiceUpdateInput,
} from "../validators/catalog.validators.js";
import type { IStaffAccess } from "../../models/access/StaffAccess.js";
import { catalogService } from "../../services/catalog.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { getAuditContext } from "./request-audit-context.js";

type CatalogQuery = {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  branchId?: string;
  isActive?: boolean;
  isPublished?: boolean;
  isOnlineBookable?: boolean;
  branchIds?: string[];
};

type CategoryQuery = {
  page?: number;
  limit?: number;
  search?: string;
  parentId?: string;
  appliesTo?: "service" | "product" | "package";
  isActive?: boolean;
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

export const listCategories = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.listCategories(
    validatedQuery<CategoryQuery>(req),
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const listPublicCategories = catchAsync(
  async (req: Request, res: Response) => {
    const result = await catalogService.listCategories(
      validatedQuery<CategoryQuery>(req),
      true,
    );
    res.status(200).json({
      success: true,
      data: result.data,
      meta: { pagination: result.pagination },
    });
  },
);

export const getCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await catalogService.getCategory(routeParam(req, "categoryId"));
  res.status(200).json({ success: true, data: category });
});

export const getPublicCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await catalogService.getCategory(routeParam(req, "categoryId"), true);
  res.status(200).json({ success: true, data: category });
});

export const createCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await catalogService.createCategory(
    validatedBody<CategoryCreateInput>(req),
    getAuditContext(req, res),
  );
  res.status(201).json({ success: true, data: category });
});

export const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await catalogService.updateCategory(
    routeParam(req, "categoryId"),
    validatedBody<CategoryUpdateInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: category });
});

export const archiveCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await catalogService.archiveCategory(
    routeParam(req, "categoryId"),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: category });
});

export const listServices = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.listServices(
    validatedQuery<CatalogQuery>(req),
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const listPublicServices = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.listServices(
    validatedQuery<CatalogQuery>(req),
    true,
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const getService = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.getService(
    routeParam(req, "serviceId"),
    false,
    typeof req.query.branchId === "string" ? req.query.branchId : undefined,
  );
  res.status(200).json({ success: true, data: result });
});

export const getPublicService = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.getService(
    routeParam(req, "serviceId"),
    true,
    typeof req.query.branchId === "string" ? req.query.branchId : undefined,
  );
  res.status(200).json({ success: true, data: result });
});

export const createService = catchAsync(async (req: Request, res: Response) => {
  const service = await catalogService.createService(
    validatedBody<ServiceCreateInput>(req),
    getAuditContext(req, res),
  );
  res.status(201).json({ success: true, data: service });
});

export const updateService = catchAsync(async (req: Request, res: Response) => {
  const service = await catalogService.updateService(
    routeParam(req, "serviceId"),
    validatedBody<ServiceUpdateInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: service });
});

export const archiveService = catchAsync(async (req: Request, res: Response) => {
  const service = await catalogService.archiveService(
    routeParam(req, "serviceId"),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: service });
});

export const listProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.listProducts(
    validatedQuery<CatalogQuery>(req),
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const listPublicProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.listProducts(
    validatedQuery<CatalogQuery>(req),
    true,
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const getProduct = catchAsync(async (req: Request, res: Response) => {
  const product = await catalogService.getProduct(routeParam(req, "productId"));
  res.status(200).json({ success: true, data: product });
});

export const getPublicProduct = catchAsync(async (req: Request, res: Response) => {
  const product = await catalogService.getProduct(routeParam(req, "productId"), true);
  res.status(200).json({ success: true, data: product });
});

export const createProduct = catchAsync(async (req: Request, res: Response) => {
  const product = await catalogService.createProduct(
    validatedBody<ProductCreateInput>(req),
    getAuditContext(req, res),
  );
  res.status(201).json({ success: true, data: product });
});

export const updateProduct = catchAsync(async (req: Request, res: Response) => {
  const product = await catalogService.updateProduct(
    routeParam(req, "productId"),
    validatedBody<ProductUpdateInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: product });
});

export const archiveProduct = catchAsync(async (req: Request, res: Response) => {
  const product = await catalogService.archiveProduct(
    routeParam(req, "productId"),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: product });
});

export const listPackages = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.listPackages(
    validatedQuery<CatalogQuery>(req),
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const listPublicPackages = catchAsync(async (req: Request, res: Response) => {
  const result = await catalogService.listPackages(
    validatedQuery<CatalogQuery>(req),
    true,
  );
  res.status(200).json({
    success: true,
    data: result.data,
    meta: { pagination: result.pagination },
  });
});

export const getPackage = catchAsync(async (req: Request, res: Response) => {
  const servicePackage = await catalogService.getPackage(routeParam(req, "packageId"));
  res.status(200).json({ success: true, data: servicePackage });
});

export const getPublicPackage = catchAsync(async (req: Request, res: Response) => {
  const servicePackage = await catalogService.getPackage(
    routeParam(req, "packageId"),
    true,
  );
  res.status(200).json({ success: true, data: servicePackage });
});

export const createPackage = catchAsync(async (req: Request, res: Response) => {
  const servicePackage = await catalogService.createPackage(
    validatedBody<PackageCreateInput>(req),
    getAuditContext(req, res),
  );
  res.status(201).json({ success: true, data: servicePackage });
});

export const updatePackage = catchAsync(async (req: Request, res: Response) => {
  const servicePackage = await catalogService.updatePackage(
    routeParam(req, "packageId"),
    validatedBody<PackageUpdateInput>(req),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: servicePackage });
});

export const archivePackage = catchAsync(async (req: Request, res: Response) => {
  const servicePackage = await catalogService.archivePackage(
    routeParam(req, "packageId"),
    getAuditContext(req, res),
  );
  res.status(200).json({ success: true, data: servicePackage });
});

export const listBranchServices = catchAsync(async (req: Request, res: Response) => {
  const access = staffScope(res);
  const result = await catalogService.listBranchServices(
    {
      ...validatedQuery<CatalogQuery>(req),
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

export const getBranchService = catchAsync(async (req: Request, res: Response) => {
  const branchService = await catalogService.getBranchService(
    routeParam(req, "branchServiceId"),
  );
  res.status(200).json({ success: true, data: branchService });
});

export const createBranchService = catchAsync(
  async (req: Request, res: Response) => {
    const branchService = await catalogService.createBranchService(
      validatedBody<BranchServiceCreateInput>(req),
      getAuditContext(req, res),
    );
    res.status(201).json({ success: true, data: branchService });
  },
);

export const updateBranchService = catchAsync(
  async (req: Request, res: Response) => {
    const branchService = await catalogService.updateBranchService(
      routeParam(req, "branchServiceId"),
      validatedBody<BranchServiceUpdateInput>(req),
      getAuditContext(req, res),
    );
    res.status(200).json({ success: true, data: branchService });
  },
);

export const archiveBranchService = catchAsync(
  async (req: Request, res: Response) => {
    const branchService = await catalogService.archiveBranchService(
      routeParam(req, "branchServiceId"),
      getAuditContext(req, res),
    );
    res.status(200).json({ success: true, data: branchService });
  },
);

export const catalogController = {
  archiveBranchService,
  archiveCategory,
  archivePackage,
  archiveProduct,
  archiveService,
  createBranchService,
  createCategory,
  createPackage,
  createProduct,
  createService,
  getBranchService,
  getCategory,
  getPackage,
  getProduct,
  getPublicCategory,
  getPublicPackage,
  getPublicProduct,
  getPublicService,
  getService,
  listBranchServices,
  listCategories,
  listPackages,
  listProducts,
  listPublicCategories,
  listPublicPackages,
  listPublicProducts,
  listPublicServices,
  listServices,
  updateBranchService,
  updateCategory,
  updatePackage,
  updateProduct,
  updateService,
};

export default catalogController;
