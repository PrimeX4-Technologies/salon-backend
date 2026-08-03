import { config } from "../config/env.js";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type SecurityMode = "public" | "auth" | "staff" | "admin" | "customer" | "employee";

interface ApiRoute {
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  security?: SecurityMode;
  bodySchema?: string;
  query?: string[];
  statusCode?: number;
  webhook?: boolean;
}

const objectIdPattern = "^[a-fA-F0-9]{24}$";

const schemas = {
  ApiSuccess: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: { type: "object", additionalProperties: true },
      meta: { type: "object", additionalProperties: true },
    },
    required: ["success"],
  },
  ApiError: {
    type: "object",
    properties: {
      success: { type: "boolean", example: false },
      error: {
        type: "object",
        properties: {
          code: { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string" },
          details: {},
          requestId: { type: "string", format: "uuid" },
        },
        required: ["code", "message", "requestId"],
      },
    },
    required: ["success", "error"],
  },
  CustomerRegistrationInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 2, maxLength: 120, example: "Nimali Perera" },
      email: { type: "string", format: "email", example: "nimali@example.com" },
      phone: { type: "string", pattern: "^\\+[1-9]\\d{7,14}$", example: "+94771234567" },
      password: {
        type: "string",
        format: "password",
        minLength: 8,
        maxLength: 200,
        example: "StrongPass123",
      },
    },
    required: ["name", "password"],
  },
  LoginInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      identifier: {
        type: "string",
        minLength: 3,
        maxLength: 254,
        example: "nimali@example.com",
      },
      password: { type: "string", format: "password", example: "StrongPass123" },
    },
    required: ["identifier", "password"],
  },
  GoogleLoginInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      idToken: {
        type: "string",
        minLength: 100,
        maxLength: 10_000,
        description: "Google ID token. Customer accounts only.",
      },
    },
    required: ["idToken"],
  },
  RefreshTokenInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      refreshToken: {
        type: "string",
        description: "Optional when the refresh token is sent via secure cookie.",
      },
    },
  },
  ChangePasswordInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      currentPassword: { type: "string", format: "password" },
      newPassword: { type: "string", format: "password", minLength: 8 },
    },
    required: ["newPassword"],
  },
  ForgotPasswordInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      identifier: { type: "string", minLength: 3, maxLength: 254 },
    },
    required: ["identifier"],
  },
  ResetPasswordInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      token: { type: "string", minLength: 32, maxLength: 512 },
      newPassword: { type: "string", format: "password", minLength: 8 },
    },
    required: ["token", "newPassword"],
  },
  ConfirmEmailInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      token: { type: "string", minLength: 32, maxLength: 512 },
    },
    required: ["token"],
  },
  GenericJsonBody: {
    type: "object",
    additionalProperties: true,
    description:
      "Request body validated by backend Zod schemas. See README for module behavior; this OpenAPI file gives route coverage for Swagger/Postman and can be enriched with exact DTOs over time.",
  },
  IdempotentJsonBody: {
    allOf: [{ $ref: "#/components/schemas/GenericJsonBody" }],
    description:
      "Validated JSON body. Mutating booking/payment requests should use an Idempotency-Key header when supported by the operation.",
  },
} as const;

const authRoutes: ApiRoute[] = [
  {
    method: "post",
    path: "/api/v1/auth/register/customer",
    tag: "Auth",
    summary: "Register a customer with email/mobile and password",
    security: "public",
    bodySchema: "CustomerRegistrationInput",
    statusCode: 201,
  },
  {
    method: "post",
    path: "/api/v1/auth/login",
    tag: "Auth",
    summary: "Login with email/mobile and password",
    security: "public",
    bodySchema: "LoginInput",
  },
  {
    method: "post",
    path: "/api/v1/auth/google",
    tag: "Auth",
    summary: "Customer login or signup with Google ID token",
    security: "public",
    bodySchema: "GoogleLoginInput",
  },
  {
    method: "post",
    path: "/api/v1/auth/refresh",
    tag: "Auth",
    summary: "Rotate a refresh session and return a new access token",
    security: "public",
    bodySchema: "RefreshTokenInput",
  },
  { method: "post", path: "/api/v1/auth/logout", tag: "Auth", summary: "Logout current session" },
  {
    method: "post",
    path: "/api/v1/auth/logout-all",
    tag: "Auth",
    summary: "Revoke all refresh sessions",
  },
  {
    method: "patch",
    path: "/api/v1/auth/password",
    tag: "Auth",
    summary: "Change password for the authenticated user",
    bodySchema: "ChangePasswordInput",
  },
  { method: "get", path: "/api/v1/auth/me", tag: "Auth", summary: "Get current user" },
  {
    method: "post",
    path: "/api/v1/auth/password/forgot",
    tag: "Auth",
    summary: "Request a password reset token",
    security: "public",
    bodySchema: "ForgotPasswordInput",
  },
  {
    method: "post",
    path: "/api/v1/auth/password/reset",
    tag: "Auth",
    summary: "Reset password with a one-time token",
    security: "public",
    bodySchema: "ResetPasswordInput",
  },
  {
    method: "post",
    path: "/api/v1/auth/email-verification/request",
    tag: "Auth",
    summary: "Request email verification",
  },
  {
    method: "post",
    path: "/api/v1/auth/email-verification/confirm",
    tag: "Auth",
    summary: "Confirm email with a one-time token",
    security: "public",
    bodySchema: "ConfirmEmailInput",
  },
  { method: "get", path: "/api/v1/auth/sessions", tag: "Auth", summary: "List active sessions" },
  {
    method: "delete",
    path: "/api/v1/auth/sessions/{sessionId}",
    tag: "Auth",
    summary: "Revoke one refresh session",
  },
];

const publicRoutes: ApiRoute[] = [
  {
    method: "get",
    path: "/api/v1/public/business",
    tag: "Public",
    summary: "Get public salon overview",
    security: "public",
  },
  {
    method: "get",
    path: "/api/v1/public/branches",
    tag: "Public",
    summary: "List public branches",
    security: "public",
    query: ["page", "limit", "search", "status"],
  },
  {
    method: "get",
    path: "/api/v1/public/branches/{branchId}",
    tag: "Public",
    summary: "Get public branch",
    security: "public",
  },
  {
    method: "get",
    path: "/api/v1/public/branches/{branchId}/hours",
    tag: "Public",
    summary: "Get current public branch hours",
    security: "public",
    query: ["date"],
  },
  {
    method: "get",
    path: "/api/v1/public/availability",
    tag: "Public",
    summary: "Find public booking availability",
    security: "public",
    query: ["branchId", "serviceId", "employeeId", "date", "durationMinutes"],
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/categories",
    tag: "Public Catalog",
    summary: "List public catalog categories",
    security: "public",
    query: ["page", "limit", "search", "branchId"],
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/categories/{categoryId}",
    tag: "Public Catalog",
    summary: "Get public catalog category",
    security: "public",
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/services",
    tag: "Public Catalog",
    summary: "List public services",
    security: "public",
    query: ["page", "limit", "search", "branchId", "categoryId"],
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/services/{serviceId}",
    tag: "Public Catalog",
    summary: "Get public service",
    security: "public",
    query: ["branchId"],
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/products",
    tag: "Public Catalog",
    summary: "List public products",
    security: "public",
    query: ["page", "limit", "search", "branchId", "categoryId"],
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/products/{productId}",
    tag: "Public Catalog",
    summary: "Get public product",
    security: "public",
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/packages",
    tag: "Public Catalog",
    summary: "List inquiry-only service packages",
    security: "public",
    query: ["page", "limit", "search", "branchId", "categoryId"],
  },
  {
    method: "get",
    path: "/api/v1/public/catalog/packages/{packageId}",
    tag: "Public Catalog",
    summary: "Get public service package",
    security: "public",
  },
];

const customerRoutes: ApiRoute[] = [
  {
    method: "get",
    path: "/api/v1/customers/me",
    tag: "Customers",
    summary: "Get my customer profile",
    security: "customer",
  },
  {
    method: "patch",
    path: "/api/v1/customers/me",
    tag: "Customers",
    summary: "Update my customer profile",
    security: "customer",
    bodySchema: "GenericJsonBody",
  },
  {
    method: "get",
    path: "/api/v1/customers",
    tag: "Customers",
    summary: "List customers",
    security: "staff",
    query: ["page", "limit", "search", "status", "branchId"],
  },
  {
    method: "post",
    path: "/api/v1/customers",
    tag: "Customers",
    summary: "Create customer",
    security: "staff",
    bodySchema: "GenericJsonBody",
    statusCode: 201,
  },
  {
    method: "get",
    path: "/api/v1/customers/{customerId}",
    tag: "Customers",
    summary: "Get customer",
    security: "staff",
  },
  {
    method: "patch",
    path: "/api/v1/customers/{customerId}",
    tag: "Customers",
    summary: "Update customer",
    security: "staff",
    bodySchema: "GenericJsonBody",
  },
  {
    method: "delete",
    path: "/api/v1/customers/{customerId}",
    tag: "Customers",
    summary: "Archive customer",
    security: "staff",
  },
];

const bookingRoutes: ApiRoute[] = [
  { method: "get", path: "/api/v1/customer/bookings", tag: "Customer Bookings", summary: "List my bookings", security: "customer", query: ["page", "limit", "status", "branchId", "from", "to"] },
  { method: "post", path: "/api/v1/customer/bookings", tag: "Customer Bookings", summary: "Create direct booking or hold", security: "customer", bodySchema: "IdempotentJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/customer/bookings/{bookingId}", tag: "Customer Bookings", summary: "Get my booking", security: "customer" },
  { method: "post", path: "/api/v1/customer/bookings/{bookingId}/cancel", tag: "Customer Bookings", summary: "Cancel my booking", security: "customer", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/customer/bookings/{bookingId}/reschedule", tag: "Customer Bookings", summary: "Reschedule my booking", security: "customer", bodySchema: "IdempotentJsonBody" },
  { method: "get", path: "/api/v1/customer/waitlist", tag: "Customer Bookings", summary: "List my waitlist entries", security: "customer", query: ["page", "limit", "status", "branchId"] },
  { method: "post", path: "/api/v1/customer/waitlist", tag: "Customer Bookings", summary: "Join waitlist", security: "customer", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/customer/waitlist/{waitlistEntryId}", tag: "Customer Bookings", summary: "Get my waitlist entry", security: "customer" },
  { method: "post", path: "/api/v1/customer/waitlist/{waitlistEntryId}/cancel", tag: "Customer Bookings", summary: "Cancel my waitlist entry", security: "customer", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/customer/inquiries", tag: "Customer Inquiries", summary: "List my inquiries", security: "customer", query: ["page", "limit", "status"] },
  { method: "post", path: "/api/v1/customer/inquiries", tag: "Customer Inquiries", summary: "Create consultation, wedding, offsite, or package inquiry", security: "customer", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/customer/inquiries/{inquiryId}", tag: "Customer Inquiries", summary: "Get my inquiry", security: "customer" },
  { method: "post", path: "/api/v1/customer/inquiries/{inquiryId}/cancel", tag: "Customer Inquiries", summary: "Cancel my inquiry", security: "customer" },
  { method: "post", path: "/api/v1/customer/quotes/{quoteId}/accept", tag: "Customer Inquiries", summary: "Accept quote", security: "customer" },
  { method: "post", path: "/api/v1/customer/quotes/{quoteId}/reject", tag: "Customer Inquiries", summary: "Reject quote", security: "customer", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/staff/bookings", tag: "Staff Bookings", summary: "List branch-scoped bookings", security: "staff", query: ["page", "limit", "status", "branchId", "customerId", "employeeId", "from", "to"] },
  { method: "post", path: "/api/v1/staff/bookings", tag: "Staff Bookings", summary: "Create booking for customer", security: "staff", bodySchema: "IdempotentJsonBody", statusCode: 201 },
  { method: "post", path: "/api/v1/staff/bookings/expire-holds", tag: "Staff Bookings", summary: "Expire due booking holds", security: "staff" },
  { method: "get", path: "/api/v1/staff/bookings/{bookingId}", tag: "Staff Bookings", summary: "Get booking", security: "staff" },
  { method: "post", path: "/api/v1/staff/bookings/{bookingId}/cancel", tag: "Staff Bookings", summary: "Cancel booking", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/staff/bookings/{bookingId}/reschedule", tag: "Staff Bookings", summary: "Reschedule booking", security: "staff", bodySchema: "IdempotentJsonBody" },
  { method: "post", path: "/api/v1/staff/bookings/{bookingId}/transition", tag: "Staff Bookings", summary: "Move booking through lifecycle", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "put", path: "/api/v1/staff/bookings/{bookingId}/external-settlement", tag: "Staff Bookings", summary: "Attach final external settlement metadata", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/staff/waitlist", tag: "Staff Bookings", summary: "List waitlist entries", security: "staff", query: ["page", "limit", "status", "branchId"] },
  { method: "post", path: "/api/v1/staff/waitlist", tag: "Staff Bookings", summary: "Create waitlist entry", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "post", path: "/api/v1/staff/waitlist/expire-due", tag: "Staff Bookings", summary: "Expire due waitlist entries", security: "staff" },
  { method: "get", path: "/api/v1/staff/waitlist/{waitlistEntryId}", tag: "Staff Bookings", summary: "Get waitlist entry", security: "staff" },
  { method: "post", path: "/api/v1/staff/waitlist/{waitlistEntryId}/cancel", tag: "Staff Bookings", summary: "Cancel waitlist entry", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/staff/waitlist/{waitlistEntryId}/offer", tag: "Staff Bookings", summary: "Offer waitlist slot", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/staff/inquiries", tag: "Staff Inquiries", summary: "List inquiries", security: "staff", query: ["page", "limit", "status", "branchId"] },
  { method: "get", path: "/api/v1/staff/inquiries/{inquiryId}", tag: "Staff Inquiries", summary: "Get inquiry", security: "staff" },
  { method: "post", path: "/api/v1/staff/inquiries/{inquiryId}/review", tag: "Staff Inquiries", summary: "Review inquiry", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/staff/inquiries/{inquiryId}/reject", tag: "Staff Inquiries", summary: "Reject inquiry", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/staff/inquiries/{inquiryId}/quotes", tag: "Staff Inquiries", summary: "Create quote for inquiry", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "post", path: "/api/v1/staff/quotes/expire-due", tag: "Staff Inquiries", summary: "Expire due quotes", security: "staff" },
  { method: "post", path: "/api/v1/staff/quotes/{quoteId}/send", tag: "Staff Inquiries", summary: "Send quote", security: "staff" },
  { method: "post", path: "/api/v1/staff/quotes/{quoteId}/expire", tag: "Staff Inquiries", summary: "Expire quote", security: "staff" },
  { method: "post", path: "/api/v1/staff/quotes/{quoteId}/schedule", tag: "Staff Inquiries", summary: "Schedule accepted quote", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/employees/me/bookings", tag: "Employee Self Service", summary: "List my assigned bookings", security: "employee", query: ["page", "limit", "status", "from", "to"] },
  { method: "get", path: "/api/v1/employees/me/bookings/{bookingId}", tag: "Employee Self Service", summary: "Get my assigned booking", security: "employee" },
];

const adminRoutes: ApiRoute[] = [
  { method: "post", path: "/api/v1/admin/business/bootstrap", tag: "Business Admin", summary: "Bootstrap single-salon business profile and first branch", security: "admin", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/business/profile", tag: "Business Admin", summary: "Get business profile", security: "staff" },
  { method: "put", path: "/api/v1/admin/business/profile", tag: "Business Admin", summary: "Update business profile", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/admin/business/settings", tag: "Business Admin", summary: "Get business settings", security: "staff" },
  { method: "put", path: "/api/v1/admin/business/settings", tag: "Business Admin", summary: "Update business settings", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/admin/branches", tag: "Business Admin", summary: "List branches", security: "staff", query: ["page", "limit", "search", "status"] },
  { method: "post", path: "/api/v1/admin/branches", tag: "Business Admin", summary: "Create branch", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/branches/{branchId}", tag: "Business Admin", summary: "Get branch", security: "staff" },
  { method: "patch", path: "/api/v1/admin/branches/{branchId}", tag: "Business Admin", summary: "Update branch", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/branches/{branchId}", tag: "Business Admin", summary: "Archive branch", security: "staff" },
  { method: "get", path: "/api/v1/admin/branches/{branchId}/hours", tag: "Business Admin", summary: "List branch working-hour versions", security: "staff", query: ["page", "limit", "activeOn"] },
  { method: "post", path: "/api/v1/admin/branches/{branchId}/hours", tag: "Business Admin", summary: "Create branch working hours", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/branches/{branchId}/hours/{hoursId}", tag: "Business Admin", summary: "Get branch working hours", security: "staff" },
  { method: "patch", path: "/api/v1/admin/branches/{branchId}/hours/{hoursId}", tag: "Business Admin", summary: "Update branch working hours", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/branches/{branchId}/hours/{hoursId}", tag: "Business Admin", summary: "Archive branch working hours", security: "staff" },
];

const catalogAdminRoutes: ApiRoute[] = [
  ...["categories", "services", "products", "packages", "branch-services"].flatMap((resource) => [
    { method: "get" as const, path: `/api/v1/admin/catalog/${resource}`, tag: "Catalog Admin", summary: `List ${resource}`, security: "staff" as const, query: ["page", "limit", "search", "branchId", "categoryId", "status"] },
    { method: "post" as const, path: `/api/v1/admin/catalog/${resource}`, tag: "Catalog Admin", summary: `Create ${resource.slice(0, -1)}`, security: "staff" as const, bodySchema: "GenericJsonBody", statusCode: 201 },
  ]),
  { method: "get", path: "/api/v1/admin/catalog/categories/{categoryId}", tag: "Catalog Admin", summary: "Get category", security: "staff" },
  { method: "patch", path: "/api/v1/admin/catalog/categories/{categoryId}", tag: "Catalog Admin", summary: "Update category", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/catalog/categories/{categoryId}", tag: "Catalog Admin", summary: "Archive category", security: "staff" },
  { method: "get", path: "/api/v1/admin/catalog/services/{serviceId}", tag: "Catalog Admin", summary: "Get service", security: "staff", query: ["branchId"] },
  { method: "patch", path: "/api/v1/admin/catalog/services/{serviceId}", tag: "Catalog Admin", summary: "Update service", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/catalog/services/{serviceId}", tag: "Catalog Admin", summary: "Archive service", security: "staff" },
  { method: "get", path: "/api/v1/admin/catalog/products/{productId}", tag: "Catalog Admin", summary: "Get product", security: "staff" },
  { method: "patch", path: "/api/v1/admin/catalog/products/{productId}", tag: "Catalog Admin", summary: "Update product", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/catalog/products/{productId}", tag: "Catalog Admin", summary: "Archive product", security: "staff" },
  { method: "get", path: "/api/v1/admin/catalog/packages/{packageId}", tag: "Catalog Admin", summary: "Get package", security: "staff" },
  { method: "patch", path: "/api/v1/admin/catalog/packages/{packageId}", tag: "Catalog Admin", summary: "Update package", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/catalog/packages/{packageId}", tag: "Catalog Admin", summary: "Archive package", security: "staff" },
  { method: "get", path: "/api/v1/admin/catalog/branch-services/{branchServiceId}", tag: "Catalog Admin", summary: "Get branch service", security: "staff" },
  { method: "patch", path: "/api/v1/admin/catalog/branch-services/{branchServiceId}", tag: "Catalog Admin", summary: "Update branch service", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/catalog/branch-services/{branchServiceId}", tag: "Catalog Admin", summary: "Archive branch service", security: "staff" },
];

const staffRoutes: ApiRoute[] = [
  { method: "get", path: "/api/v1/employees/me", tag: "Employee Self Service", summary: "Get my employee profile", security: "employee" },
  { method: "patch", path: "/api/v1/employees/me", tag: "Employee Self Service", summary: "Update my employee profile", security: "employee", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/employees/me/time-off", tag: "Employee Self Service", summary: "List my time off", security: "employee", query: ["page", "limit", "status", "from", "to"] },
  { method: "post", path: "/api/v1/employees/me/time-off", tag: "Employee Self Service", summary: "Request time off", security: "employee", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "post", path: "/api/v1/employees/me/time-off/{timeOffId}/cancel", tag: "Employee Self Service", summary: "Cancel my time off", security: "employee" },
  { method: "get", path: "/api/v1/employees", tag: "Staff Admin", summary: "List employees", security: "staff", query: ["page", "limit", "search", "status", "branchId"] },
  { method: "post", path: "/api/v1/employees", tag: "Staff Admin", summary: "Create employee profile", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/employees/{employeeId}", tag: "Staff Admin", summary: "Get employee", security: "staff" },
  { method: "patch", path: "/api/v1/employees/{employeeId}", tag: "Staff Admin", summary: "Update employee", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/employees/{employeeId}/account", tag: "Staff Admin", summary: "Provision employee login account", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/employees/{employeeId}", tag: "Staff Admin", summary: "Terminate employee", security: "staff" },
  { method: "get", path: "/api/v1/employees/{employeeId}/access", tag: "Staff Admin", summary: "Get employee access policy", security: "staff" },
  { method: "put", path: "/api/v1/employees/{employeeId}/access", tag: "Staff Admin", summary: "Update employee access policy", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/employees/{employeeId}/skills", tag: "Staff Admin", summary: "List employee skills", security: "staff" },
  { method: "put", path: "/api/v1/employees/{employeeId}/skills/{skillId}", tag: "Staff Admin", summary: "Assign or update employee skill", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/employees/{employeeId}/skills/{skillId}", tag: "Staff Admin", summary: "Remove employee skill", security: "staff" },
  { method: "get", path: "/api/v1/employees/{employeeId}/services", tag: "Staff Admin", summary: "List employee service assignments", security: "staff", query: ["branchId", "active"] },
  { method: "put", path: "/api/v1/employees/{employeeId}/services/{serviceId}/branches/{branchId}", tag: "Staff Admin", summary: "Assign service to employee at branch", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/employees/{employeeId}/services/{serviceId}/branches/{branchId}", tag: "Staff Admin", summary: "Remove employee service assignment", security: "staff" },
  { method: "get", path: "/api/v1/admins", tag: "Staff Admin", summary: "List admin users", security: "admin", query: ["page", "limit", "search", "status"] },
  { method: "post", path: "/api/v1/admins", tag: "Staff Admin", summary: "Create admin user", security: "admin", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admins/{adminId}", tag: "Staff Admin", summary: "Get admin user", security: "admin" },
  { method: "patch", path: "/api/v1/admins/{adminId}", tag: "Staff Admin", summary: "Update admin user", security: "admin", bodySchema: "GenericJsonBody" },
  { method: "put", path: "/api/v1/admins/{adminId}/access", tag: "Staff Admin", summary: "Update admin access policy", security: "admin", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/skills", tag: "Staff Admin", summary: "List skills", security: "staff", query: ["active"] },
  { method: "post", path: "/api/v1/skills", tag: "Staff Admin", summary: "Create skill", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "patch", path: "/api/v1/skills/{skillId}", tag: "Staff Admin", summary: "Update skill", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/skills/{skillId}", tag: "Staff Admin", summary: "Deactivate skill", security: "staff" },
  { method: "get", path: "/api/v1/employee-levels", tag: "Staff Admin", summary: "List employee levels", security: "staff", query: ["active"] },
  { method: "post", path: "/api/v1/employee-levels", tag: "Staff Admin", summary: "Create employee level", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "patch", path: "/api/v1/employee-levels/{levelId}", tag: "Staff Admin", summary: "Update employee level", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/employee-levels/{levelId}", tag: "Staff Admin", summary: "Deactivate employee level", security: "staff" },
];

const schedulingRoutes: ApiRoute[] = [
  { method: "get", path: "/api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules", tag: "Scheduling Admin", summary: "List employee schedules", security: "staff", query: ["page", "limit", "from", "to", "active"] },
  { method: "post", path: "/api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules", tag: "Scheduling Admin", summary: "Create employee schedule", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules/{scheduleId}", tag: "Scheduling Admin", summary: "Get employee schedule", security: "staff" },
  { method: "patch", path: "/api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules/{scheduleId}", tag: "Scheduling Admin", summary: "Update employee schedule", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules/{scheduleId}", tag: "Scheduling Admin", summary: "Archive employee schedule", security: "staff" },
  { method: "get", path: "/api/v1/admin/scheduling/time-off", tag: "Scheduling Admin", summary: "List staff time off", security: "staff", query: ["page", "limit", "status", "branchId", "employeeId", "from", "to"] },
  { method: "post", path: "/api/v1/admin/scheduling/time-off/{timeOffId}/approve", tag: "Scheduling Admin", summary: "Approve time off", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/admin/scheduling/time-off/{timeOffId}/reject", tag: "Scheduling Admin", summary: "Reject time off", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/admin/scheduling/time-off/{timeOffId}/cancel", tag: "Scheduling Admin", summary: "Cancel staff time off", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/admin/scheduling/branches/{branchId}/calendar-blocks", tag: "Scheduling Admin", summary: "List calendar blocks", security: "staff", query: ["page", "limit", "from", "to", "resourceId", "employeeId"] },
  { method: "post", path: "/api/v1/admin/scheduling/branches/{branchId}/calendar-blocks", tag: "Scheduling Admin", summary: "Create calendar block", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/scheduling/branches/{branchId}/calendar-blocks/{blockId}", tag: "Scheduling Admin", summary: "Get calendar block", security: "staff" },
  { method: "patch", path: "/api/v1/admin/scheduling/branches/{branchId}/calendar-blocks/{blockId}", tag: "Scheduling Admin", summary: "Update calendar block", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/scheduling/branches/{branchId}/calendar-blocks/{blockId}", tag: "Scheduling Admin", summary: "Cancel calendar block", security: "staff" },
  { method: "get", path: "/api/v1/admin/scheduling/branches/{branchId}/resources", tag: "Scheduling Admin", summary: "List bookable resources", security: "staff", query: ["page", "limit", "type", "active"] },
  { method: "post", path: "/api/v1/admin/scheduling/branches/{branchId}/resources", tag: "Scheduling Admin", summary: "Create bookable resource", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/scheduling/branches/{branchId}/resources/{resourceId}", tag: "Scheduling Admin", summary: "Get bookable resource", security: "staff" },
  { method: "patch", path: "/api/v1/admin/scheduling/branches/{branchId}/resources/{resourceId}", tag: "Scheduling Admin", summary: "Update bookable resource", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/scheduling/branches/{branchId}/resources/{resourceId}", tag: "Scheduling Admin", summary: "Deactivate bookable resource", security: "staff" },
];

const paymentRoutes: ApiRoute[] = [
  { method: "get", path: "/api/v1/customer/payments", tag: "Payments", summary: "List my advance payments", security: "customer", query: ["page", "limit", "status", "bookingId"] },
  { method: "post", path: "/api/v1/customer/payments/advance-checkouts", tag: "Payments", summary: "Create customer advance checkout", security: "customer", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/customer/payments/{paymentId}", tag: "Payments", summary: "Get my payment", security: "customer" },
  { method: "get", path: "/api/v1/staff/payments", tag: "Payments", summary: "List branch-scoped advance payments", security: "staff", query: ["page", "limit", "status", "branchId", "bookingId", "customerId"] },
  { method: "post", path: "/api/v1/staff/payments/advances", tag: "Payments", summary: "Record advance payment", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/staff/payments/webhook-events", tag: "Payments", summary: "List payment webhook events", security: "admin", query: ["page", "limit", "provider", "status"] },
  { method: "post", path: "/api/v1/staff/payments/webhook-events/{webhookEventId}/retry", tag: "Payments", summary: "Retry payment webhook event", security: "admin" },
  { method: "post", path: "/api/v1/staff/payments/{paymentId}/refunds", tag: "Payments", summary: "Record advance refund", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/staff/payments/{paymentId}", tag: "Payments", summary: "Get staff payment", security: "staff" },
  { method: "post", path: "/api/v1/webhooks/payments/{provider}", tag: "Webhooks", summary: "Receive raw payment provider webhook", security: "public", statusCode: 202, webhook: true },
];

const notificationRoutes: ApiRoute[] = [
  { method: "get", path: "/api/v1/notifications/preferences", tag: "Notifications", summary: "Get my notification preferences" },
  { method: "put", path: "/api/v1/notifications/preferences", tag: "Notifications", summary: "Update my notification preferences", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/notifications/push-subscriptions", tag: "Notifications", summary: "List my push subscriptions" },
  { method: "post", path: "/api/v1/notifications/push-subscriptions", tag: "Notifications", summary: "Register push subscription", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "delete", path: "/api/v1/notifications/push-subscriptions/{subscriptionId}", tag: "Notifications", summary: "Revoke push subscription" },
  { method: "get", path: "/api/v1/admin/notifications/queue", tag: "Notifications Admin", summary: "List notification queue", security: "staff", query: ["page", "limit", "status", "channel", "recipientRole"] },
  { method: "post", path: "/api/v1/admin/notifications/queue/{notificationId}/retry", tag: "Notifications Admin", summary: "Retry notification", security: "staff" },
  { method: "post", path: "/api/v1/admin/notifications/queue/{notificationId}/cancel", tag: "Notifications Admin", summary: "Cancel notification", security: "staff" },
  { method: "get", path: "/api/v1/admin/notifications/templates", tag: "Notifications Admin", summary: "List notification templates", security: "staff", query: ["page", "limit", "channel", "eventType", "active"] },
  { method: "post", path: "/api/v1/admin/notifications/templates", tag: "Notifications Admin", summary: "Create notification template", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/notifications/templates/{templateId}", tag: "Notifications Admin", summary: "Get notification template", security: "staff" },
  { method: "patch", path: "/api/v1/admin/notifications/templates/{templateId}", tag: "Notifications Admin", summary: "Update notification template", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "delete", path: "/api/v1/admin/notifications/templates/{templateId}", tag: "Notifications Admin", summary: "Deactivate notification template", security: "staff" },
];

const integrationRoutes: ApiRoute[] = [
  { method: "get", path: "/api/v1/admin/integrations/connectors", tag: "Integrations", summary: "List external ERP/POS connectors", security: "staff", query: ["page", "limit", "provider", "status"] },
  { method: "post", path: "/api/v1/admin/integrations/connectors", tag: "Integrations", summary: "Create connector", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "get", path: "/api/v1/admin/integrations/connectors/{connectorId}", tag: "Integrations", summary: "Get connector", security: "staff" },
  { method: "patch", path: "/api/v1/admin/integrations/connectors/{connectorId}", tag: "Integrations", summary: "Update connector", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "put", path: "/api/v1/admin/integrations/connectors/{connectorId}/status", tag: "Integrations", summary: "Set connector status", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/admin/integrations/connectors/{connectorId}/mappings", tag: "Integrations", summary: "List external entity mappings", security: "staff", query: ["page", "limit", "localEntityType", "externalEntityType", "status"] },
  { method: "put", path: "/api/v1/admin/integrations/connectors/{connectorId}/mappings", tag: "Integrations", summary: "Upsert external entity mapping", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "post", path: "/api/v1/admin/integrations/connectors/{connectorId}/mappings/{mappingId}/resolve", tag: "Integrations", summary: "Resolve mapping conflict", security: "staff", bodySchema: "GenericJsonBody" },
  { method: "get", path: "/api/v1/admin/integrations/connectors/{connectorId}/sync-jobs", tag: "Integrations", summary: "List integration sync jobs", security: "staff", query: ["page", "limit", "direction", "status", "entityType"] },
  { method: "post", path: "/api/v1/admin/integrations/connectors/{connectorId}/sync-jobs", tag: "Integrations", summary: "Queue integration sync job", security: "staff", bodySchema: "GenericJsonBody", statusCode: 201 },
  { method: "post", path: "/api/v1/admin/integrations/connectors/{connectorId}/sync-jobs/{syncJobId}/retry", tag: "Integrations", summary: "Retry integration sync job", security: "staff" },
  { method: "get", path: "/api/v1/admin/audit-logs", tag: "Operations", summary: "List audit logs", security: "admin", query: ["page", "limit", "actorId", "entityType", "action", "from", "to"] },
  { method: "get", path: "/api/v1/admin/outbox", tag: "Operations", summary: "List outbox events", security: "admin", query: ["page", "limit", "status", "eventType"] },
  { method: "post", path: "/api/v1/admin/outbox/{outboxEventId}/retry", tag: "Operations", summary: "Retry outbox event", security: "admin" },
];

const routes = [
  ...authRoutes,
  ...publicRoutes,
  ...customerRoutes,
  ...bookingRoutes,
  ...adminRoutes,
  ...catalogAdminRoutes,
  ...staffRoutes,
  ...schedulingRoutes,
  ...paymentRoutes,
  ...notificationRoutes,
  ...integrationRoutes,
];

const successResponse = (description = "Successful response") => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiSuccess" },
    },
  },
});

const errorResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
});

const extractPathParameters = (path: string) => {
  const matches = path.matchAll(/\{([^}]+)\}/g);
  return [...matches].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: match[1]?.endsWith("Id")
      ? { type: "string", pattern: objectIdPattern }
      : { type: "string" },
  }));
};

const queryParameters = (names: string[] = []) =>
  names.map((name) => ({
    name,
    in: "query",
    required: false,
    schema:
      name === "page" || name === "limit" || name === "durationMinutes"
        ? { type: "integer", minimum: 1 }
        : { type: "string" },
  }));

const securityFor = (mode: SecurityMode = "auth") => {
  if (mode === "public") return [];
  if (mode === "staff") return [{ bearerAuth: [], staffPermissions: [] }];
  if (mode === "admin") return [{ bearerAuth: [], staffPermissions: [] }];
  if (mode === "customer") return [{ bearerAuth: [] }];
  if (mode === "employee") return [{ bearerAuth: [], staffPermissions: [] }];
  return [{ bearerAuth: [] }];
};

const requestBodyFor = (route: ApiRoute) => {
  if (route.webhook) {
    return {
      required: true,
      content: {
        "application/json": { schema: { type: "object", additionalProperties: true } },
        "text/plain": { schema: { type: "string" } },
        "application/octet-stream": { schema: { type: "string", format: "binary" } },
      },
    };
  }

  if (!route.bodySchema) return undefined;
  return {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${route.bodySchema}` },
      },
    },
  };
};

const paths: Record<string, Record<string, unknown>> = {};

for (const route of routes) {
  const operation = {
    tags: [route.tag],
    summary: route.summary,
    operationId: `${route.method}_${route.path
      .replace(/^\/api\/v1\//, "")
      .replace(/[{}]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")}`,
    security: securityFor(route.security),
    parameters: [
      ...extractPathParameters(route.path),
      ...queryParameters(route.query),
      ...(route.method !== "get" && !route.webhook
        ? [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", minLength: 8, maxLength: 120 },
              description:
                "Recommended for retryable mutating requests such as booking and payment actions.",
            },
          ]
        : []),
    ],
    ...(requestBodyFor(route) ? { requestBody: requestBodyFor(route) } : {}),
    responses: {
      [route.statusCode ?? (route.method === "post" ? 200 : route.method === "delete" ? 204 : 200)]:
        successResponse(),
      400: errorResponse("Bad request or validation error"),
      401: errorResponse("Authentication required"),
      403: errorResponse("Role, permission, or branch access denied"),
      404: errorResponse("Resource not found"),
      409: errorResponse("Version conflict, duplicate resource, or booking conflict"),
      429: errorResponse("Rate limit exceeded"),
      500: errorResponse("Internal server error"),
    },
  };

  paths[route.path] = {
    ...(paths[route.path] ?? {}),
    [route.method]: operation,
  };
}

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Salon Booking API",
    version: "1.0.0",
    description:
      "Single-salon, optional multi-branch booking API for customers, employees, admins, scheduling, catalog, advance payments, notifications, and external ERP/POS integration metadata.",
    contact: { name: "PrimeX" },
  },
  servers: [
    {
      url: `http://localhost:${config.PORT}`,
      description: "Local development server",
    },
    {
      url: "/",
      description: "Same origin server",
    },
  ],
  tags: [
    { name: "Auth", description: "Customer, employee, and admin authentication" },
    { name: "Public", description: "Public salon, branch, and availability APIs" },
    { name: "Public Catalog", description: "Public services, products, and packages" },
    { name: "Customers", description: "Customer profile and CRM APIs" },
    { name: "Customer Bookings", description: "Customer direct booking and waitlist APIs" },
    { name: "Customer Inquiries", description: "Customer quote/inquiry APIs" },
    { name: "Staff Bookings", description: "Staff booking operations" },
    { name: "Staff Inquiries", description: "Staff quote/inquiry operations" },
    { name: "Business Admin", description: "Single salon profile, settings, branches, and hours" },
    { name: "Catalog Admin", description: "Services, products, packages, and branch service setup" },
    { name: "Staff Admin", description: "Admins, employees, skills, levels, and access policy" },
    { name: "Employee Self Service", description: "Employee profile, booking, and time-off APIs" },
    { name: "Scheduling Admin", description: "Schedules, resources, time-off, and calendar blocks" },
    { name: "Payments", description: "Advance payment and refund APIs only" },
    { name: "Webhooks", description: "Provider webhook ingestion" },
    { name: "Notifications", description: "Self notification preferences and push subscriptions" },
    { name: "Notifications Admin", description: "Notification queue and template management" },
    { name: "Integrations", description: "External ERP/POS connector and sync metadata" },
    { name: "Operations", description: "Audit and outbox operational APIs" },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access token returned by /api/v1/auth/login, /google, or /refresh.",
      },
      staffPermissions: {
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description:
          "Staff permissions are derived from the authenticated StaffAccess record, not from a client-supplied header.",
      },
    },
    parameters: {
      RequestId: {
        name: "X-Request-Id",
        in: "header",
        required: false,
        schema: { type: "string", maxLength: 120 },
      },
    },
    headers: {
      RequestId: {
        description: "Correlation ID for logs and support.",
        schema: { type: "string" },
      },
    },
    schemas,
  },
} as const;

