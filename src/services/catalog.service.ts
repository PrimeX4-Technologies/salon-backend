import type { QueryFilter, Types } from "mongoose";

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
} from "../api/validators/catalog.validators.js";
import Branch from "../models/business/Branch.js";
import BusinessSettings from "../models/business/BusinessSettings.js";
import BranchService, {
  type IBranchService,
} from "../models/catalog/BranchService.js";
import CatalogCategory, {
  type ICatalogCategory,
} from "../models/catalog/CatalogCategory.js";
import Product, { type IProduct } from "../models/catalog/Product.js";
import ServiceModel, { type IService } from "../models/catalog/Service.js";
import ServicePackage, {
  type IServicePackage,
} from "../models/catalog/ServicePackage.js";
import type { IPricePresentation } from "../models/core/pricing.js";
import { isSafeExternalHttpsUrl } from "../models/core/shared.js";
import EmployeeLevel from "../models/staff/EmployeeLevel.js";
import Skill from "../models/staff/Skill.js";
import { ApiError } from "../utils/ApiError.js";
import {
  buildPaginationMeta,
  escapeRegExp,
  parsePagination,
  type PaginationMeta,
} from "../utils/pagination.js";
import {
  withBookingConfigWriteLease,
  withBookingConfigWriteLeases,
} from "./booking-config-lock.service.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";

interface ListResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

interface CatalogListQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  branchId?: string;
  isActive?: boolean;
  isPublished?: boolean;
  isOnlineBookable?: boolean;
  branchIds?: string[];
}

interface CategoryListQuery {
  page?: number;
  limit?: number;
  search?: string;
  parentId?: string;
  appliesTo?: "service" | "product" | "package";
  isActive?: boolean;
}

const BOOKING_AFFECTING_SERVICE_FIELDS = new Set<keyof ServiceUpdateInput>([
  "targetClientGender",
  "requiredSkillIds",
  "duration",
  "price",
  "tierPrices",
  "advancePolicy",
  "bookingMode",
  "isActive",
  "isOnlineBookable",
]);

const serviceUpdateAffectsBooking = (input: ServiceUpdateInput): boolean =>
  Object.keys(input).some((field) =>
    BOOKING_AFFECTING_SERVICE_FIELDS.has(field as keyof ServiceUpdateInput),
  );

const changedFields = (input: Record<string, unknown>): string[] =>
  Object.keys(input).sort();

const normalizeOptionalFields = <T extends Record<string, unknown>>(payload: T): T => {
  const normalized = { ...payload };
  Object.entries(normalized).forEach(([key, value]) => {
    if (value === null) {
      (normalized as Record<string, unknown>)[key] = undefined;
    }
  });
  return normalized;
};

const requireCategory = async (
  categoryId: string,
  appliesTo: "service" | "product" | "package",
  requireActive = true,
) => {
  const category = await CatalogCategory.findById(categoryId);
  if (!category) {
    throw ApiError.notFound("Catalog category not found", "CATEGORY_NOT_FOUND");
  }
  if (!category.appliesTo.includes(appliesTo)) {
    throw ApiError.badRequest(
      `The selected category does not apply to ${appliesTo}s`,
      undefined,
      "CATEGORY_TYPE_MISMATCH",
    );
  }
  if (requireActive && !category.isActive) {
    throw ApiError.conflict(
      "An active catalog item requires an active category",
      undefined,
      "CATEGORY_INACTIVE",
    );
  }
  return category;
};

const requireBranches = async (branchIds: string[], requireActive = true): Promise<void> => {
  const uniqueIds = [...new Set(branchIds)];
  if (uniqueIds.length === 0) return;
  const filter: Record<string, unknown> = { _id: { $in: uniqueIds } };
  if (requireActive) filter.isActive = true;
  const count = await Branch.countDocuments(filter);
  if (count !== uniqueIds.length) {
    throw ApiError.badRequest(
      requireActive
        ? "Every selected branch must exist and be active"
        : "One or more selected branches do not exist",
      undefined,
      "INVALID_BRANCH_REFERENCE",
    );
  }
};

const requireReferences = async (
  ids: string[],
  label: "skill" | "employee level",
  requireActive = true,
): Promise<void> => {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length) {
    throw ApiError.badRequest(
      `${label} references must be unique`,
      undefined,
      "DUPLICATE_REFERENCE",
    );
  }
  if (uniqueIds.length === 0) return;
  const filter: QueryFilter<{ isActive: boolean }> = { _id: { $in: uniqueIds } };
  if (requireActive) filter.isActive = true;
  const count =
    label === "skill"
      ? await Skill.countDocuments(filter)
      : await EmployeeLevel.countDocuments(filter);
  if (count !== uniqueIds.length) {
    throw ApiError.badRequest(
      `One or more ${label} references are invalid or inactive`,
      undefined,
      "INVALID_REFERENCE",
    );
  }
};

const getBusinessCurrency = async (): Promise<string> => {
  const settings = await BusinessSettings.findOne({ singletonKey: "default" })
    .select("currency")
    .lean();
  return settings?.currency ?? "LKR";
};

const assertCurrency = (
  price: IPricePresentation | undefined | null,
  currency: string,
  path = "price",
): void => {
  if (price && price.currency !== currency) {
    throw ApiError.badRequest(
      `${path}.currency must match the business currency (${currency})`,
      { expected: currency, received: price.currency },
      "CURRENCY_MISMATCH",
    );
  }
};

const assertCategoryParent = async (
  parentId: string | null | undefined,
  categoryId?: string,
): Promise<void> => {
  if (!parentId) return;
  if (categoryId === parentId) {
    throw ApiError.badRequest(
      "A category cannot be its own parent",
      undefined,
      "CATEGORY_PARENT_CYCLE",
    );
  }

  let currentId: string | undefined = parentId;
  const visited = new Set<string>(categoryId ? [categoryId] : []);
  for (let depth = 0; currentId && depth < 100; depth += 1) {
    if (visited.has(currentId)) {
      throw ApiError.badRequest(
        "Category parent assignment would create a cycle",
        undefined,
        "CATEGORY_PARENT_CYCLE",
      );
    }
    visited.add(currentId);
    const parentDocument: Pick<ICatalogCategory, "parentId" | "isActive"> | null =
      await CatalogCategory.findById(currentId)
      .select("parentId isActive")
      .lean();
    if (!parentDocument) {
      throw ApiError.badRequest(
        "Parent category does not exist",
        undefined,
        "INVALID_PARENT_CATEGORY",
      );
    }
    currentId = parentDocument.parentId?.toString();
  }
  if (currentId) {
    throw ApiError.badRequest(
      "Category hierarchy is too deep",
      undefined,
      "CATEGORY_DEPTH_EXCEEDED",
    );
  }
};

const assertCategoryTypesMayChange = async (
  categoryId: string,
  appliesTo: Array<"service" | "product" | "package">,
): Promise<void> => {
  const counts = await Promise.all([
    appliesTo.includes("service")
      ? Promise.resolve(0)
      : ServiceModel.countDocuments({ categoryId, isActive: true }),
    appliesTo.includes("product")
      ? Promise.resolve(0)
      : Product.countDocuments({ categoryId, isActive: true }),
    appliesTo.includes("package")
      ? Promise.resolve(0)
      : ServicePackage.countDocuments({ categoryId, isActive: true }),
  ]);
  if (counts.some((count) => count > 0)) {
    throw ApiError.conflict(
      "Category types cannot be removed while active catalog items use them",
      undefined,
      "CATEGORY_IN_USE",
    );
  }
};

const validateServiceInput = async (
  input: ServiceCreateInput | ServiceUpdateInput,
  current?: IService,
): Promise<void> => {
  const categoryId = input.categoryId ?? current?.categoryId.toString();
  const isActive = input.isActive ?? current?.isActive ?? true;
  if (categoryId) await requireCategory(categoryId, "service", isActive);

  const skillIds =
    input.requiredSkillIds ?? current?.requiredSkillIds.map((id) => id.toString()) ?? [];
  await requireReferences(skillIds, "skill", isActive);

  const tierPrices = input.tierPrices ?? current?.tierPrices ?? [];
  const employeeLevelIds = tierPrices.map((tier) => tier.employeeLevelId.toString());
  await requireReferences(employeeLevelIds, "employee level", isActive);

  const currency = await getBusinessCurrency();
  assertCurrency(input.price ?? current?.price, currency);
  tierPrices.forEach((tier, index) =>
    assertCurrency(tier.price, currency, `tierPrices.${index}.price`),
  );
};

const validateProductInput = async (
  input: ProductCreateInput | ProductUpdateInput,
  current?: IProduct,
): Promise<void> => {
  const categoryId = input.categoryId ?? current?.categoryId.toString();
  const isActive = input.isActive ?? current?.isActive ?? true;
  if (categoryId) await requireCategory(categoryId, "product", isActive);

  const allBranches =
    input.availableAtAllBranches ?? current?.availableAtAllBranches ?? true;
  const branchIds =
    input.branchIds ?? current?.branchIds.map((id) => id.toString()) ?? [];
  if (!allBranches) await requireBranches(branchIds, isActive);

  const currency = await getBusinessCurrency();
  assertCurrency(input.price ?? current?.price, currency);

  const purchaseMode = input.purchaseMode ?? current?.purchaseMode ?? "in_store";
  const externalUrl =
    input.externalPurchaseUrl === null
      ? undefined
      : input.externalPurchaseUrl ?? current?.externalPurchaseUrl;
  if (purchaseMode === "external_link") {
    if (!externalUrl || !isSafeExternalHttpsUrl(externalUrl)) {
      throw ApiError.badRequest(
        "External product links must be safe public HTTPS URLs",
        undefined,
        "UNSAFE_EXTERNAL_URL",
      );
    }
  }
};

const validatePackageInput = async (
  input: PackageCreateInput | PackageUpdateInput,
  current?: IServicePackage,
): Promise<void> => {
  const categoryId = input.categoryId ?? current?.categoryId.toString();
  const isActive = input.isActive ?? current?.isActive ?? true;
  if (categoryId) await requireCategory(categoryId, "package", isActive);

  const allBranches =
    input.availableAtAllBranches ?? current?.availableAtAllBranches ?? true;
  const branchIds =
    input.branchIds ?? current?.branchIds.map((id) => id.toString()) ?? [];
  if (!allBranches) await requireBranches(branchIds, isActive);

  const components = input.serviceComponents ?? current?.serviceComponents ?? [];
  const serviceIds = components.map((item) => item.serviceId.toString());
  if (new Set(serviceIds).size !== serviceIds.length) {
    throw ApiError.badRequest(
      "Each service may appear only once in a package",
      undefined,
      "DUPLICATE_PACKAGE_COMPONENT",
    );
  }
  const serviceFilter: Record<string, unknown> = { _id: { $in: serviceIds } };
  if (isActive) serviceFilter.isActive = true;
  const serviceCount = await ServiceModel.countDocuments(serviceFilter);
  if (serviceCount !== serviceIds.length) {
    throw ApiError.badRequest(
      "One or more package services are invalid or inactive",
      undefined,
      "INVALID_PACKAGE_SERVICE",
    );
  }

  const inclusions = input.productInclusions ?? current?.productInclusions ?? [];
  const productIds = inclusions.map((item) => item.productId.toString());
  if (new Set(productIds).size !== productIds.length) {
    throw ApiError.badRequest(
      "Each product may appear only once in a package",
      undefined,
      "DUPLICATE_PACKAGE_INCLUSION",
    );
  }
  if (productIds.length > 0) {
    const productFilter: Record<string, unknown> = { _id: { $in: productIds } };
    if (isActive) productFilter.isActive = true;
    const productCount = await Product.countDocuments(productFilter);
    if (productCount !== productIds.length) {
      throw ApiError.badRequest(
        "One or more package products are invalid or inactive",
        undefined,
        "INVALID_PACKAGE_PRODUCT",
      );
    }
  }

  const currency = await getBusinessCurrency();
  assertCurrency(input.price ?? current?.price, currency);
};

const validateBranchServiceInput = async (
  input: BranchServiceCreateInput | BranchServiceUpdateInput,
  current?: IBranchService,
): Promise<void> => {
  const branchId = input.branchId ?? current?.branchId.toString();
  const serviceId = input.serviceId ?? current?.serviceId.toString();
  const isActive = input.isActive ?? current?.isActive ?? true;
  const isOnlineBookable =
    input.isOnlineBookable ?? current?.isOnlineBookable ?? true;

  const [branch, service, currency] = await Promise.all([
    Branch.findById(branchId),
    ServiceModel.findById(serviceId),
    getBusinessCurrency(),
  ]);
  if (!branch) throw ApiError.badRequest("Branch does not exist", undefined, "INVALID_BRANCH");
  if (!service) {
    throw ApiError.badRequest("Service does not exist", undefined, "INVALID_SERVICE");
  }
  if (isActive && (!branch.isActive || !service.isActive)) {
    throw ApiError.conflict(
      "An active branch service requires an active branch and service",
      undefined,
      "INACTIVE_BRANCH_SERVICE_DEPENDENCY",
    );
  }
  if (
    isOnlineBookable &&
    (!isActive ||
      !branch.bookingsEnabled ||
      !service.isOnlineBookable ||
      service.bookingMode === "consultation_required")
  ) {
    throw ApiError.conflict(
      "This branch/service combination cannot be enabled for online booking",
      undefined,
      "BRANCH_SERVICE_NOT_BOOKABLE",
    );
  }
  assertCurrency(input.priceOverride ?? current?.priceOverride, currency, "priceOverride");
};

export const listCategories = async (
  query: CategoryListQuery,
  publicOnly = false,
): Promise<ListResult<unknown>> => {
  const pagination = parsePagination(query as Record<string, unknown>);
  const filter: QueryFilter<ICatalogCategory> = {};
  if (publicOnly) filter.isActive = true;
  else if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.parentId) filter.parentId = query.parentId;
  if (query.appliesTo) filter.appliesTo = query.appliesTo;
  if (query.search) {
    const search = new RegExp(escapeRegExp(query.search), "i");
    filter.$or = [{ name: search }, { slug: search }, { description: search }];
  }

  const [data, total] = await Promise.all([
    CatalogCategory.find(filter)
      .select("-__v")
      .sort({ sortOrder: 1, name: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    CatalogCategory.countDocuments(filter),
  ]);
  return { data, pagination: buildPaginationMeta(total, pagination) };
};

export const getCategory = async (categoryId: string, publicOnly = false) => {
  const category = await CatalogCategory.findOne({
    _id: categoryId,
    ...(publicOnly ? { isActive: true } : {}),
  })
    .select("-__v")
    .lean();
  if (!category) {
    throw ApiError.notFound("Catalog category not found", "CATEGORY_NOT_FOUND");
  }
  return category;
};

export const createCategory = async (
  input: CategoryCreateInput,
  context: AuditActorContext,
) => {
  await assertCategoryParent(input.parentId);
  if (input.parentId && (input.isActive ?? true)) {
    const parent = await CatalogCategory.findById(input.parentId)
      .select("isActive")
      .lean();
    if (!parent?.isActive) {
      throw ApiError.conflict(
        "An active category requires an active parent",
        undefined,
        "PARENT_CATEGORY_INACTIVE",
      );
    }
  }
  const category = new CatalogCategory(normalizeOptionalFields(input));
  await category.save();
  await recordAudit({
    context,
    action: "catalog_category.created",
    entityType: "CatalogCategory",
    entityId: category._id,
    changes: {
      slug: category.slug,
      appliesTo: category.appliesTo,
      parentId: category.parentId?.toString(),
      isActive: category.isActive,
    },
  });
  return category;
};

export const updateCategory = async (
  categoryId: string,
  input: CategoryUpdateInput,
  context: AuditActorContext,
) => {
  const category = await CatalogCategory.findById(categoryId);
  if (!category) {
    throw ApiError.notFound("Catalog category not found", "CATEGORY_NOT_FOUND");
  }
  await assertCategoryParent(input.parentId, categoryId);
  if (input.appliesTo) {
    await assertCategoryTypesMayChange(categoryId, input.appliesTo);
  }
  if (input.isActive === false && category.isActive) {
    const [children, services, products, packages] = await Promise.all([
      CatalogCategory.countDocuments({ parentId: categoryId, isActive: true }),
      ServiceModel.countDocuments({ categoryId, isActive: true }),
      Product.countDocuments({ categoryId, isActive: true }),
      ServicePackage.countDocuments({ categoryId, isActive: true }),
    ]);
    if (children + services + products + packages > 0) {
      throw ApiError.conflict(
        "Archive active child categories and catalog items first",
        { children, services, products, packages },
        "CATEGORY_IN_USE",
      );
    }
  }
  if ((input.isActive ?? category.isActive) && input.parentId !== null) {
    const parentId = input.parentId ?? category.parentId?.toString();
    if (parentId) {
      const parent = await CatalogCategory.findById(parentId).select("isActive").lean();
      if (!parent?.isActive) {
        throw ApiError.conflict(
          "An active category requires an active parent",
          undefined,
          "PARENT_CATEGORY_INACTIVE",
        );
      }
    }
  }
  category.set(normalizeOptionalFields(input));
  await category.save();
  await recordAudit({
    context,
    action: "catalog_category.updated",
    entityType: "CatalogCategory",
    entityId: category._id,
    changes: {
      changedFields: changedFields(input),
      isActive: category.isActive,
    },
  });
  return category;
};

export const archiveCategory = async (
  categoryId: string,
  context: AuditActorContext,
) => {
  const category = await CatalogCategory.findById(categoryId);
  if (!category) {
    throw ApiError.notFound("Catalog category not found", "CATEGORY_NOT_FOUND");
  }
  const [children, services, products, packages] = await Promise.all([
    CatalogCategory.countDocuments({ parentId: categoryId, isActive: true }),
    ServiceModel.countDocuments({ categoryId, isActive: true }),
    Product.countDocuments({ categoryId, isActive: true }),
    ServicePackage.countDocuments({ categoryId, isActive: true }),
  ]);
  if (children + services + products + packages > 0) {
    throw ApiError.conflict(
      "Archive active child categories and catalog items first",
      { children, services, products, packages },
      "CATEGORY_IN_USE",
    );
  }
  category.isActive = false;
  await category.save();
  await recordAudit({
    context,
    action: "catalog_category.archived",
    entityType: "CatalogCategory",
    entityId: category._id,
    changes: { isActive: false },
  });
  return category;
};

export const listServices = async (
  query: CatalogListQuery,
  publicOnly = false,
): Promise<ListResult<unknown>> => {
  const pagination = parsePagination(query as Record<string, unknown>);
  if (publicOnly && query.branchId) await requireBranches([query.branchId]);
  const filter: QueryFilter<IService> = {};
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (publicOnly) {
    filter.isActive = true;
    filter.isOnlineBookable = true;
  } else {
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.isOnlineBookable !== undefined) {
      filter.isOnlineBookable = query.isOnlineBookable;
    }
  }
  if (query.search) {
    const search = new RegExp(escapeRegExp(query.search), "i");
    filter.$or = [{ name: search }, { code: search }, { slug: search }];
  }
  if (query.branchId) {
    const branchServiceFilter: QueryFilter<IBranchService> = {
      branchId: query.branchId,
    };
    if (publicOnly) {
      branchServiceFilter.isActive = true;
      branchServiceFilter.isOnlineBookable = true;
    }
    const serviceIds = await BranchService.distinct("serviceId", branchServiceFilter);
    filter._id = { $in: serviceIds };
  }

  const [data, total] = await Promise.all([
    ServiceModel.find(filter)
      .select("-__v")
      .populate("categoryId", "name slug")
      .sort({ sortOrder: 1, name: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    ServiceModel.countDocuments(filter),
  ]);
  return { data, pagination: buildPaginationMeta(total, pagination) };
};

export const getService = async (
  serviceId: string,
  publicOnly = false,
  branchId?: string,
) => {
  const service = await ServiceModel.findOne({
    _id: serviceId,
    ...(publicOnly ? { isActive: true, isOnlineBookable: true } : {}),
  })
    .select("-__v")
    .populate("categoryId", "name slug")
    .lean();
  if (!service) throw ApiError.notFound("Service not found", "SERVICE_NOT_FOUND");

  let branchConfiguration = null;
  if (branchId) {
    branchConfiguration = await BranchService.findOne({
      branchId,
      serviceId,
      ...(publicOnly ? { isActive: true, isOnlineBookable: true } : {}),
    })
      .select("-__v")
      .lean();
    if (publicOnly && !branchConfiguration) {
      throw ApiError.notFound(
        "Service is unavailable at this branch",
        "BRANCH_SERVICE_NOT_FOUND",
      );
    }
  }
  return { service, branchConfiguration };
};

export const createService = async (
  input: ServiceCreateInput,
  context: AuditActorContext,
) => {
  await validateServiceInput(input);
  const service = new ServiceModel(normalizeOptionalFields(input));
  await service.save();
  await recordAudit({
    context,
    action: "catalog_service.created",
    entityType: "Service",
    entityId: service._id,
    changes: {
      code: service.code,
      categoryId: service.categoryId.toString(),
      bookingMode: service.bookingMode,
      isActive: service.isActive,
      isOnlineBookable: service.isOnlineBookable,
    },
  });
  return service;
};

export const updateService = async (
  serviceId: string,
  input: ServiceUpdateInput,
  context: AuditActorContext,
  auditAction = "catalog_service.updated",
) => {
  const initialService = await ServiceModel.findById(serviceId).select("_id");
  if (!initialService) {
    throw ApiError.notFound("Service not found", "SERVICE_NOT_FOUND");
  }
  const affectedBranchIds = serviceUpdateAffectsBooking(input)
    ? (await Branch.distinct("_id", {})) as Types.ObjectId[]
    : [];

  return withBookingConfigWriteLeases(
    affectedBranchIds,
    async (leaseGuard) => {
      const service = await ServiceModel.findById(serviceId);
      if (!service) {
        throw ApiError.notFound("Service not found", "SERVICE_NOT_FOUND");
      }
      if (input.isActive === false && service.isActive) {
        const packageCount = await ServicePackage.countDocuments({
          "serviceComponents.serviceId": serviceId,
          isActive: true,
        });
        if (packageCount > 0) {
          throw ApiError.conflict(
            "Archive active packages that use this service first",
            { packageCount },
            "SERVICE_IN_USE",
          );
        }
      }
      await validateServiceInput(input, service);
      await leaseGuard.assertValid();
      service.set(normalizeOptionalFields(input));
      await service.save();
      if (!service.isActive || !service.isOnlineBookable) {
        await BranchService.updateMany(
          { serviceId: service._id },
          {
            $set: {
              ...(!service.isActive ? { isActive: false } : {}),
              isOnlineBookable: false,
            },
          },
        );
      }
      await recordAudit({
        context,
        action: auditAction,
        entityType: "Service",
        entityId: service._id,
        changes: {
          changedFields: changedFields(input),
          bookingMode: service.bookingMode,
          isActive: service.isActive,
          isOnlineBookable: service.isOnlineBookable,
        },
      });
      return service;
    },
  );
};

export const archiveService = async (
  serviceId: string,
  context: AuditActorContext,
) =>
  updateService(
    serviceId,
    { isActive: false, isOnlineBookable: false },
    context,
    "catalog_service.archived",
  );

export const listProducts = async (
  query: CatalogListQuery,
  publicOnly = false,
): Promise<ListResult<unknown>> => {
  const pagination = parsePagination(query as Record<string, unknown>);
  if (publicOnly && query.branchId) await requireBranches([query.branchId]);
  const filter: QueryFilter<IProduct> = {};
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (publicOnly) {
    filter.isActive = true;
    filter.isPublished = true;
    // Legacy records may still contain the formerly accepted "instant" value.
    // Packages are inquiry-based until atomic package expansion is implemented.
    filter.bookingMode = {
      $in: ["request_quote", "consultation_required"],
    };
  } else {
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.isPublished !== undefined) filter.isPublished = query.isPublished;
  }
  if (query.branchId) {
    filter.$or = [
      { availableAtAllBranches: true },
      { branchIds: query.branchId },
    ];
  }
  if (query.search) {
    const search = new RegExp(escapeRegExp(query.search), "i");
    const searchFilter = [
      { name: search },
      { code: search },
      { sku: search },
      { barcode: search },
      { brand: search },
    ];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchFilter }];
      delete filter.$or;
    } else {
      filter.$or = searchFilter;
    }
  }

  const [data, total] = await Promise.all([
    Product.find(filter)
      .select("-__v")
      .populate("categoryId", "name slug")
      .sort({ sortOrder: 1, name: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  return { data, pagination: buildPaginationMeta(total, pagination) };
};

export const getProduct = async (productId: string, publicOnly = false) => {
  const product = await Product.findOne({
    _id: productId,
    ...(publicOnly ? { isActive: true, isPublished: true } : {}),
  })
    .select("-__v")
    .populate("categoryId", "name slug")
    .lean();
  if (!product) throw ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");
  return product;
};

export const createProduct = async (
  input: ProductCreateInput,
  context: AuditActorContext,
) => {
  await validateProductInput(input);
  const product = new Product(normalizeOptionalFields(input));
  await product.save();
  await recordAudit({
    context,
    action: "catalog_product.created",
    entityType: "Product",
    entityId: product._id,
    changes: {
      code: product.code,
      categoryId: product.categoryId.toString(),
      availableAtAllBranches: product.availableAtAllBranches,
      isActive: product.isActive,
      isPublished: product.isPublished,
    },
  });
  return product;
};

export const updateProduct = async (
  productId: string,
  input: ProductUpdateInput,
  context: AuditActorContext,
  auditAction = "catalog_product.updated",
) => {
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");
  if (input.isActive === false && product.isActive) {
    const packageCount = await ServicePackage.countDocuments({
      "productInclusions.productId": productId,
      isActive: true,
    });
    if (packageCount > 0) {
      throw ApiError.conflict(
        "Archive active packages that use this product first",
        { packageCount },
        "PRODUCT_IN_USE",
      );
    }
  }
  await validateProductInput(input, product);
  product.set(normalizeOptionalFields(input));
  await product.save();
  await recordAudit({
    context,
    action: auditAction,
    entityType: "Product",
    entityId: product._id,
    changes: {
      changedFields: changedFields(input),
      availableAtAllBranches: product.availableAtAllBranches,
      isActive: product.isActive,
      isPublished: product.isPublished,
    },
  });
  return product;
};

export const archiveProduct = async (
  productId: string,
  context: AuditActorContext,
) =>
  updateProduct(
    productId,
    { isActive: false, isPublished: false },
    context,
    "catalog_product.archived",
  );

export const listPackages = async (
  query: CatalogListQuery,
  publicOnly = false,
): Promise<ListResult<unknown>> => {
  const pagination = parsePagination(query as Record<string, unknown>);
  if (publicOnly && query.branchId) await requireBranches([query.branchId]);
  const filter: QueryFilter<IServicePackage> = {};
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (publicOnly) {
    filter.isActive = true;
    filter.isPublished = true;
  } else {
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.isPublished !== undefined) filter.isPublished = query.isPublished;
  }
  if (query.branchId) {
    filter.$or = [
      { availableAtAllBranches: true },
      { branchIds: query.branchId },
    ];
  }
  if (query.search) {
    const search = new RegExp(escapeRegExp(query.search), "i");
    const searchFilter = [{ name: search }, { code: search }, { slug: search }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchFilter }];
      delete filter.$or;
    } else {
      filter.$or = searchFilter;
    }
  }

  const [data, total] = await Promise.all([
    ServicePackage.find(filter)
      .select("-__v")
      .populate("categoryId", "name slug")
      .sort({ sortOrder: 1, name: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    ServicePackage.countDocuments(filter),
  ]);
  return { data, pagination: buildPaginationMeta(total, pagination) };
};

export const getPackage = async (packageId: string, publicOnly = false) => {
  const servicePackage = await ServicePackage.findOne({
    _id: packageId,
    ...(publicOnly
      ? {
          isActive: true,
          isPublished: true,
          bookingMode: {
            $in: ["request_quote", "consultation_required"],
          },
        }
      : {}),
  })
    .select("-__v")
    .populate("categoryId", "name slug")
    .populate("serviceComponents.serviceId", "name slug duration price bookingMode")
    .populate("productInclusions.productId", "name slug price")
    .lean();
  if (!servicePackage) {
    throw ApiError.notFound("Service package not found", "PACKAGE_NOT_FOUND");
  }
  return servicePackage;
};

export const createPackage = async (
  input: PackageCreateInput,
  context: AuditActorContext,
) => {
  await validatePackageInput(input);
  const servicePackage = new ServicePackage(normalizeOptionalFields(input));
  await servicePackage.save();
  await recordAudit({
    context,
    action: "service_package.created",
    entityType: "ServicePackage",
    entityId: servicePackage._id,
    changes: {
      code: servicePackage.code,
      categoryId: servicePackage.categoryId.toString(),
      availableAtAllBranches: servicePackage.availableAtAllBranches,
      isActive: servicePackage.isActive,
      isPublished: servicePackage.isPublished,
    },
  });
  return servicePackage;
};

export const updatePackage = async (
  packageId: string,
  input: PackageUpdateInput,
  context: AuditActorContext,
  auditAction = "service_package.updated",
) => {
  const servicePackage = await ServicePackage.findById(packageId);
  if (!servicePackage) {
    throw ApiError.notFound("Service package not found", "PACKAGE_NOT_FOUND");
  }
  await validatePackageInput(input, servicePackage);
  const migratedLegacyInstantMode =
    (servicePackage.bookingMode as string) === "instant" &&
    input.bookingMode === undefined;
  servicePackage.set({
    ...normalizeOptionalFields(input),
    ...(migratedLegacyInstantMode
      ? { bookingMode: "request_quote" as const }
      : {}),
  });
  await servicePackage.save();
  await recordAudit({
    context,
    action: auditAction,
    entityType: "ServicePackage",
    entityId: servicePackage._id,
    changes: {
      changedFields: changedFields(input),
      ...(migratedLegacyInstantMode
        ? { legacyBookingModeMigrated: "instant -> request_quote" }
        : {}),
      availableAtAllBranches: servicePackage.availableAtAllBranches,
      isActive: servicePackage.isActive,
      isPublished: servicePackage.isPublished,
    },
  });
  return servicePackage;
};

export const archivePackage = async (
  packageId: string,
  context: AuditActorContext,
) =>
  updatePackage(
    packageId,
    { isActive: false, isPublished: false },
    context,
    "service_package.archived",
  );

export const listBranchServices = async (
  query: CatalogListQuery,
  publicOnly = false,
): Promise<ListResult<unknown>> => {
  const pagination = parsePagination(query as Record<string, unknown>);
  const filter: QueryFilter<IBranchService> = {};
  if (query.branchId) {
    filter.branchId =
      query.branchIds && !query.branchIds.includes(query.branchId)
        ? { $in: [] }
        : query.branchId;
  }
  else if (query.branchIds) filter.branchId = { $in: query.branchIds };
  if (publicOnly) {
    filter.isActive = true;
    filter.isOnlineBookable = true;
  } else {
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.isOnlineBookable !== undefined) {
      filter.isOnlineBookable = query.isOnlineBookable;
    }
  }
  if (query.categoryId || query.search) {
    const serviceFilter: QueryFilter<IService> = {};
    if (query.categoryId) serviceFilter.categoryId = query.categoryId;
    if (query.search) {
      const search = new RegExp(escapeRegExp(query.search), "i");
      serviceFilter.$or = [{ name: search }, { code: search }, { slug: search }];
    }
    const matchingServices = await ServiceModel.find(serviceFilter).select("_id").lean();
    filter.serviceId = { $in: matchingServices.map((service) => service._id) };
  }

  const [data, total] = await Promise.all([
    BranchService.find(filter)
      .select("-__v")
      .populate("branchId", "name code isActive bookingsEnabled")
      .populate("serviceId", "name code slug duration price isActive isOnlineBookable")
      .sort({ branchId: 1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    BranchService.countDocuments(filter),
  ]);
  return { data, pagination: buildPaginationMeta(total, pagination) };
};

export const getBranchService = async (
  branchServiceId: string,
  publicOnly = false,
) => {
  const branchService = await BranchService.findOne({
    _id: branchServiceId,
    ...(publicOnly ? { isActive: true, isOnlineBookable: true } : {}),
  })
    .select("-__v")
    .populate("branchId", "name code isActive bookingsEnabled")
    .populate("serviceId", "name code slug duration price isActive isOnlineBookable")
    .lean();
  if (!branchService) {
    throw ApiError.notFound("Branch service not found", "BRANCH_SERVICE_NOT_FOUND");
  }
  return branchService;
};

export const createBranchService = async (
  input: BranchServiceCreateInput,
  context: AuditActorContext,
) => {
  return withBookingConfigWriteLease(
    input.branchId,
    async (leaseGuard) => {
      await validateBranchServiceInput(input);
      await leaseGuard.assertValid();
      const branchService = new BranchService(normalizeOptionalFields(input));
      await branchService.save();
      await recordAudit({
        context,
        action: "branch_service.created",
        entityType: "BranchService",
        entityId: branchService._id,
        changes: {
          branchId: branchService.branchId.toString(),
          serviceId: branchService.serviceId.toString(),
          isActive: branchService.isActive,
          isOnlineBookable: branchService.isOnlineBookable,
        },
      });
      return branchService;
    },
  );
};

export const updateBranchService = async (
  branchServiceId: string,
  input: BranchServiceUpdateInput,
  context: AuditActorContext,
  auditAction = "branch_service.updated",
) => {
  const initialBranchService = await BranchService.findById(
    branchServiceId,
  ).select("branchId");
  if (!initialBranchService) {
    throw ApiError.notFound("Branch service not found", "BRANCH_SERVICE_NOT_FOUND");
  }
  const branchIds = [
    initialBranchService.branchId,
    ...(input.branchId ? [input.branchId] : []),
  ];
  return withBookingConfigWriteLeases(
    branchIds,
    async (leaseGuard) => {
      const branchService = await BranchService.findById(branchServiceId);
      if (!branchService) {
        throw ApiError.notFound(
          "Branch service not found",
          "BRANCH_SERVICE_NOT_FOUND",
        );
      }
      await validateBranchServiceInput(input, branchService);
      await leaseGuard.assertValid();
      branchService.set(normalizeOptionalFields(input));
      await branchService.save();
      await recordAudit({
        context,
        action: auditAction,
        entityType: "BranchService",
        entityId: branchService._id,
        changes: {
          changedFields: changedFields(input),
          branchId: branchService.branchId.toString(),
          serviceId: branchService.serviceId.toString(),
          isActive: branchService.isActive,
          isOnlineBookable: branchService.isOnlineBookable,
        },
      });
      return branchService;
    },
  );
};

export const archiveBranchService = async (
  branchServiceId: string,
  context: AuditActorContext,
) =>
  updateBranchService(
    branchServiceId,
    {
      isActive: false,
      isOnlineBookable: false,
    },
    context,
    "branch_service.archived",
  );

export const catalogService = {
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
  getService,
  listBranchServices,
  listCategories,
  listPackages,
  listProducts,
  listServices,
  updateBranchService,
  updateCategory,
  updatePackage,
  updateProduct,
  updateService,
};

export default catalogService;
