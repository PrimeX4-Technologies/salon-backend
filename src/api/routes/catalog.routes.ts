import { Router } from "express";

import { catalogController } from "../controllers/catalog.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  requireAllBranchAccess,
  requireBranchServiceAccess,
} from "../middlewares/business-access.middleware.js";
import {
  requireBranchAccess,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  branchServiceCreateSchema,
  branchServiceIdSchema,
  branchServiceUpdateSchema,
  catalogListSchema,
  categoryCreateSchema,
  categoryIdSchema,
  categoryListSchema,
  categoryUpdateSchema,
  packageCreateSchema,
  packageIdSchema,
  packageUpdateSchema,
  productCreateSchema,
  productIdSchema,
  productUpdateSchema,
  serviceCreateSchema,
  serviceDetailSchema,
  serviceIdSchema,
  serviceUpdateSchema,
} from "../validators/catalog.validators.js";

export const adminCatalogRouter = Router();

adminCatalogRouter.use(authenticate, requirePermissions("manage_catalog"));

adminCatalogRouter.get(
  "/categories",
  validate({ query: categoryListSchema.shape.query }),
  catalogController.listCategories,
);
adminCatalogRouter.post(
  "/categories",
  requireAllBranchAccess,
  validate({ body: categoryCreateSchema.shape.body }),
  catalogController.createCategory,
);
adminCatalogRouter.get(
  "/categories/:categoryId",
  validate({ params: categoryIdSchema.shape.params }),
  catalogController.getCategory,
);
adminCatalogRouter.patch(
  "/categories/:categoryId",
  requireAllBranchAccess,
  validate({
    params: categoryUpdateSchema.shape.params,
    body: categoryUpdateSchema.shape.body,
  }),
  catalogController.updateCategory,
);
adminCatalogRouter.delete(
  "/categories/:categoryId",
  requireAllBranchAccess,
  validate({ params: categoryIdSchema.shape.params }),
  catalogController.archiveCategory,
);

adminCatalogRouter.get(
  "/services",
  validate({ query: catalogListSchema.shape.query }),
  catalogController.listServices,
);
adminCatalogRouter.post(
  "/services",
  requireAllBranchAccess,
  validate({ body: serviceCreateSchema.shape.body }),
  catalogController.createService,
);
adminCatalogRouter.get(
  "/services/:serviceId",
  validate({
    params: serviceDetailSchema.shape.params,
    query: serviceDetailSchema.shape.query,
  }),
  catalogController.getService,
);
adminCatalogRouter.patch(
  "/services/:serviceId",
  requireAllBranchAccess,
  validate({
    params: serviceUpdateSchema.shape.params,
    body: serviceUpdateSchema.shape.body,
  }),
  catalogController.updateService,
);
adminCatalogRouter.delete(
  "/services/:serviceId",
  requireAllBranchAccess,
  validate({ params: serviceIdSchema.shape.params }),
  catalogController.archiveService,
);

adminCatalogRouter.get(
  "/products",
  validate({ query: catalogListSchema.shape.query }),
  catalogController.listProducts,
);
adminCatalogRouter.post(
  "/products",
  requireAllBranchAccess,
  validate({ body: productCreateSchema.shape.body }),
  catalogController.createProduct,
);
adminCatalogRouter.get(
  "/products/:productId",
  validate({ params: productIdSchema.shape.params }),
  catalogController.getProduct,
);
adminCatalogRouter.patch(
  "/products/:productId",
  requireAllBranchAccess,
  validate({
    params: productUpdateSchema.shape.params,
    body: productUpdateSchema.shape.body,
  }),
  catalogController.updateProduct,
);
adminCatalogRouter.delete(
  "/products/:productId",
  requireAllBranchAccess,
  validate({ params: productIdSchema.shape.params }),
  catalogController.archiveProduct,
);

adminCatalogRouter.get(
  "/packages",
  validate({ query: catalogListSchema.shape.query }),
  catalogController.listPackages,
);
adminCatalogRouter.post(
  "/packages",
  requireAllBranchAccess,
  validate({ body: packageCreateSchema.shape.body }),
  catalogController.createPackage,
);
adminCatalogRouter.get(
  "/packages/:packageId",
  validate({ params: packageIdSchema.shape.params }),
  catalogController.getPackage,
);
adminCatalogRouter.patch(
  "/packages/:packageId",
  requireAllBranchAccess,
  validate({
    params: packageUpdateSchema.shape.params,
    body: packageUpdateSchema.shape.body,
  }),
  catalogController.updatePackage,
);
adminCatalogRouter.delete(
  "/packages/:packageId",
  requireAllBranchAccess,
  validate({ params: packageIdSchema.shape.params }),
  catalogController.archivePackage,
);

adminCatalogRouter.get(
  "/branch-services",
  validate({ query: catalogListSchema.shape.query }),
  catalogController.listBranchServices,
);
adminCatalogRouter.post(
  "/branch-services",
  validate({ body: branchServiceCreateSchema.shape.body }),
  requireBranchAccess("branchId"),
  catalogController.createBranchService,
);
adminCatalogRouter.get(
  "/branch-services/:branchServiceId",
  validate({ params: branchServiceIdSchema.shape.params }),
  requireBranchServiceAccess,
  catalogController.getBranchService,
);
adminCatalogRouter.patch(
  "/branch-services/:branchServiceId",
  validate({
    params: branchServiceUpdateSchema.shape.params,
    body: branchServiceUpdateSchema.shape.body,
  }),
  requireBranchServiceAccess,
  catalogController.updateBranchService,
);
adminCatalogRouter.delete(
  "/branch-services/:branchServiceId",
  validate({ params: branchServiceIdSchema.shape.params }),
  requireBranchServiceAccess,
  catalogController.archiveBranchService,
);

export const publicCatalogRouter = Router();

publicCatalogRouter.get(
  "/categories",
  validate({ query: categoryListSchema.shape.query }),
  catalogController.listPublicCategories,
);
publicCatalogRouter.get(
  "/categories/:categoryId",
  validate({ params: categoryIdSchema.shape.params }),
  catalogController.getPublicCategory,
);
publicCatalogRouter.get(
  "/services",
  validate({ query: catalogListSchema.shape.query }),
  catalogController.listPublicServices,
);
publicCatalogRouter.get(
  "/services/:serviceId",
  validate({
    params: serviceDetailSchema.shape.params,
    query: serviceDetailSchema.shape.query,
  }),
  catalogController.getPublicService,
);
publicCatalogRouter.get(
  "/products",
  validate({ query: catalogListSchema.shape.query }),
  catalogController.listPublicProducts,
);
publicCatalogRouter.get(
  "/products/:productId",
  validate({ params: productIdSchema.shape.params }),
  catalogController.getPublicProduct,
);
publicCatalogRouter.get(
  "/packages",
  validate({ query: catalogListSchema.shape.query }),
  catalogController.listPublicPackages,
);
publicCatalogRouter.get(
  "/packages/:packageId",
  validate({ params: packageIdSchema.shape.params }),
  catalogController.getPublicPackage,
);

export default adminCatalogRouter;
