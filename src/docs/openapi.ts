import { config } from "../config/env.js";
import {
  inputSchemas,
  responseSchemas,
  type InputSchemaName,
  type OpenApiSchema,
  type ResponseSchemaName,
} from "./openapi.schemas.js";

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

type OperationKey = `${HttpMethod} ${string}`;

const operationKey = (route: Pick<ApiRoute, "method" | "path">): OperationKey =>
  `${route.method} ${route.path}`;

const bodySchemaByOperation: Partial<Record<OperationKey, InputSchemaName>> = {
  "patch /api/v1/customers/me": "MyCustomerProfileUpdateInput",
  "post /api/v1/customers": "CustomerCreateInput",
  "patch /api/v1/customers/{customerId}": "CustomerUpdateInput",

  "post /api/v1/customer/bookings": "BookingCreateInput",
  "post /api/v1/customer/bookings/{bookingId}/cancel": "BookingCancelInput",
  "post /api/v1/customer/bookings/{bookingId}/reschedule": "BookingRescheduleInput",
  "post /api/v1/customer/waitlist": "WaitlistCreateInput",
  "post /api/v1/customer/waitlist/{waitlistEntryId}/cancel": "WaitlistCancelInput",
  "post /api/v1/customer/inquiries": "InquiryCreateInput",
  "post /api/v1/customer/quotes/{quoteId}/reject": "QuoteActionInput",
  "post /api/v1/staff/bookings": "BookingCreateInput",
  "post /api/v1/staff/bookings/{bookingId}/cancel": "BookingCancelInput",
  "post /api/v1/staff/bookings/{bookingId}/reschedule": "BookingRescheduleInput",
  "post /api/v1/staff/bookings/{bookingId}/transition": "BookingTransitionInput",
  "put /api/v1/staff/bookings/{bookingId}/external-settlement": "ExternalSettlementInput",
  "post /api/v1/staff/waitlist": "WaitlistCreateInput",
  "post /api/v1/staff/waitlist/{waitlistEntryId}/cancel": "WaitlistCancelInput",
  "post /api/v1/staff/waitlist/{waitlistEntryId}/offer": "WaitlistOfferInput",
  "post /api/v1/staff/inquiries/{inquiryId}/review": "InquiryReviewInput",
  "post /api/v1/staff/inquiries/{inquiryId}/reject": "InquiryRejectInput",
  "post /api/v1/staff/inquiries/{inquiryId}/quotes": "QuoteCreateInput",
  "post /api/v1/staff/quotes/{quoteId}/schedule": "AcceptedQuoteScheduleInput",

  "post /api/v1/admin/business/bootstrap": "BusinessBootstrapInput",
  "put /api/v1/admin/business/profile": "BusinessProfileUpdateInput",
  "put /api/v1/admin/business/settings": "BusinessSettingsUpdateInput",
  "post /api/v1/admin/branches": "BranchCreateInput",
  "patch /api/v1/admin/branches/{branchId}": "BranchUpdateInput",
  "post /api/v1/admin/branches/{branchId}/hours": "BranchHoursCreateInput",
  "patch /api/v1/admin/branches/{branchId}/hours/{hoursId}": "BranchHoursUpdateInput",

  "post /api/v1/admin/catalog/categories": "CategoryCreateInput",
  "patch /api/v1/admin/catalog/categories/{categoryId}": "CategoryUpdateInput",
  "post /api/v1/admin/catalog/services": "ServiceCreateInput",
  "patch /api/v1/admin/catalog/services/{serviceId}": "ServiceUpdateInput",
  "post /api/v1/admin/catalog/products": "ProductCreateInput",
  "patch /api/v1/admin/catalog/products/{productId}": "ProductUpdateInput",
  "post /api/v1/admin/catalog/packages": "PackageCreateInput",
  "patch /api/v1/admin/catalog/packages/{packageId}": "PackageUpdateInput",
  "post /api/v1/admin/catalog/branch-services": "BranchServiceCreateInput",
  "patch /api/v1/admin/catalog/branch-services/{branchServiceId}": "BranchServiceUpdateInput",

  "patch /api/v1/employees/me": "MyEmployeeProfileUpdateInput",
  "post /api/v1/employees/me/time-off": "TimeOffCreateInput",
  "post /api/v1/employees": "EmployeeCreateInput",
  "patch /api/v1/employees/{employeeId}": "EmployeeUpdateInput",
  "post /api/v1/employees/{employeeId}/account": "EmployeeAccountProvisionInput",
  "put /api/v1/employees/{employeeId}/access": "StaffAccessInput",
  "put /api/v1/employees/{employeeId}/skills/{skillId}": "EmployeeSkillUpsertInput",
  "put /api/v1/employees/{employeeId}/services/{serviceId}/branches/{branchId}": "EmployeeServiceUpsertInput",
  "post /api/v1/admins": "AdminCreateInput",
  "patch /api/v1/admins/{adminId}": "AdminUpdateInput",
  "put /api/v1/admins/{adminId}/access": "StaffAccessInput",
  "post /api/v1/skills": "SkillCreateInput",
  "patch /api/v1/skills/{skillId}": "SkillUpdateInput",
  "post /api/v1/employee-levels": "EmployeeLevelCreateInput",
  "patch /api/v1/employee-levels/{levelId}": "EmployeeLevelUpdateInput",

  "post /api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules": "EmployeeScheduleCreateInput",
  "patch /api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules/{scheduleId}": "EmployeeScheduleUpdateInput",
  "post /api/v1/admin/scheduling/time-off/{timeOffId}/approve": "TimeOffDecisionInput",
  "post /api/v1/admin/scheduling/time-off/{timeOffId}/reject": "TimeOffDecisionInput",
  "post /api/v1/admin/scheduling/time-off/{timeOffId}/cancel": "TimeOffDecisionInput",
  "post /api/v1/admin/scheduling/branches/{branchId}/calendar-blocks": "CalendarBlockCreateInput",
  "patch /api/v1/admin/scheduling/branches/{branchId}/calendar-blocks/{blockId}": "CalendarBlockUpdateInput",
  "post /api/v1/admin/scheduling/branches/{branchId}/resources": "BookableResourceCreateInput",
  "patch /api/v1/admin/scheduling/branches/{branchId}/resources/{resourceId}": "BookableResourceUpdateInput",

  "post /api/v1/customer/payments/advance-checkouts": "AdvanceCheckoutCreateInput",
  "post /api/v1/staff/payments/advances": "AdvanceRecordInput",
  "post /api/v1/staff/payments/{paymentId}/refunds": "RefundRecordInput",

  "put /api/v1/notifications/preferences": "NotificationPreferenceUpdateInput",
  "post /api/v1/notifications/push-subscriptions": "PushSubscriptionCreateInput",
  "post /api/v1/admin/notifications/templates": "NotificationTemplateCreateInput",
  "patch /api/v1/admin/notifications/templates/{templateId}": "NotificationTemplateUpdateInput",

  "post /api/v1/admin/integrations/connectors": "ConnectorCreateInput",
  "patch /api/v1/admin/integrations/connectors/{connectorId}": "ConnectorUpdateInput",
  "put /api/v1/admin/integrations/connectors/{connectorId}/status": "ConnectorStatusInput",
  "put /api/v1/admin/integrations/connectors/{connectorId}/mappings": "MappingUpsertInput",
  "post /api/v1/admin/integrations/connectors/{connectorId}/mappings/{mappingId}/resolve": "MappingConflictResolutionInput",
  "post /api/v1/admin/integrations/connectors/{connectorId}/sync-jobs": "SyncJobCreateInput",
};

const querySchemaByPath: Partial<Record<string, InputSchemaName>> = {
  "/api/v1/public/branches": "BranchListQuery",
  "/api/v1/public/branches/{branchId}/hours": "CurrentBranchHoursQuery",
  "/api/v1/public/availability": "AvailabilityQuery",
  "/api/v1/public/catalog/categories": "CategoryListQuery",
  "/api/v1/public/catalog/services": "CatalogListQuery",
  "/api/v1/public/catalog/services/{serviceId}": "ServiceDetailQuery",
  "/api/v1/public/catalog/products": "CatalogListQuery",
  "/api/v1/public/catalog/packages": "CatalogListQuery",
  "/api/v1/customers": "CustomerListQuery",
  "/api/v1/customer/bookings": "BookingListQuery",
  "/api/v1/staff/bookings": "BookingListQuery",
  "/api/v1/employees/me/bookings": "EmployeeBookingListQuery",
  "/api/v1/customer/waitlist": "WaitlistListQuery",
  "/api/v1/staff/waitlist": "WaitlistListQuery",
  "/api/v1/customer/inquiries": "InquiryListQuery",
  "/api/v1/staff/inquiries": "InquiryListQuery",
  "/api/v1/admin/branches": "BranchListQuery",
  "/api/v1/admin/branches/{branchId}/hours": "BranchHoursListQuery",
  "/api/v1/admin/catalog/categories": "CategoryListQuery",
  "/api/v1/admin/catalog/services": "CatalogListQuery",
  "/api/v1/admin/catalog/services/{serviceId}": "ServiceDetailQuery",
  "/api/v1/admin/catalog/products": "CatalogListQuery",
  "/api/v1/admin/catalog/packages": "CatalogListQuery",
  "/api/v1/admin/catalog/branch-services": "CatalogListQuery",
  "/api/v1/employees/me/time-off": "MyTimeOffListQuery",
  "/api/v1/employees": "EmployeeListQuery",
  "/api/v1/employees/{employeeId}/services": "EmployeeServiceListQuery",
  "/api/v1/admins": "AdminListQuery",
  "/api/v1/skills": "ActiveOnlyQuery",
  "/api/v1/employee-levels": "ActiveOnlyQuery",
  "/api/v1/admin/scheduling/branches/{branchId}/employees/{employeeId}/schedules": "EmployeeScheduleListQuery",
  "/api/v1/admin/scheduling/time-off": "StaffTimeOffListQuery",
  "/api/v1/admin/scheduling/branches/{branchId}/calendar-blocks": "CalendarBlockListQuery",
  "/api/v1/admin/scheduling/branches/{branchId}/resources": "BookableResourceListQuery",
  "/api/v1/customer/payments": "CustomerPaymentListQuery",
  "/api/v1/staff/payments": "StaffPaymentListQuery",
  "/api/v1/staff/payments/webhook-events": "PaymentWebhookEventListQuery",
  "/api/v1/admin/notifications/queue": "NotificationQueueListQuery",
  "/api/v1/admin/notifications/templates": "NotificationTemplateListQuery",
  "/api/v1/admin/integrations/connectors": "ConnectorListQuery",
  "/api/v1/admin/integrations/connectors/{connectorId}/mappings": "MappingListQuery",
  "/api/v1/admin/integrations/connectors/{connectorId}/sync-jobs": "SyncJobListQuery",
  "/api/v1/admin/audit-logs": "AuditLogListQuery",
  "/api/v1/admin/outbox": "OutboxListQuery",
};

const paginatedQuerySchemas = new Set<InputSchemaName>([
  "BranchListQuery",
  "BranchHoursListQuery",
  "CategoryListQuery",
  "CatalogListQuery",
  "CustomerListQuery",
  "BookingListQuery",
  "EmployeeBookingListQuery",
  "WaitlistListQuery",
  "InquiryListQuery",
  "EmployeeListQuery",
  "AdminListQuery",
  "EmployeeScheduleListQuery",
  "MyTimeOffListQuery",
  "StaffTimeOffListQuery",
  "CalendarBlockListQuery",
  "BookableResourceListQuery",
  "CustomerPaymentListQuery",
  "StaffPaymentListQuery",
  "PaymentWebhookEventListQuery",
  "NotificationQueueListQuery",
  "NotificationTemplateListQuery",
  "ConnectorListQuery",
  "MappingListQuery",
  "SyncJobListQuery",
  "AuditLogListQuery",
  "OutboxListQuery",
]);

const noContentOperations = new Set<OperationKey>([
  "post /api/v1/auth/logout",
  "post /api/v1/auth/logout-all",
  "post /api/v1/auth/password/reset",
  "delete /api/v1/auth/sessions/{sessionId}",
  "delete /api/v1/customers/{customerId}",
  "delete /api/v1/employees/{employeeId}",
  "delete /api/v1/employees/{employeeId}/skills/{skillId}",
  "delete /api/v1/employees/{employeeId}/services/{serviceId}/branches/{branchId}",
  "delete /api/v1/skills/{skillId}",
  "delete /api/v1/employee-levels/{levelId}",
  "delete /api/v1/notifications/push-subscriptions/{subscriptionId}",
]);

const idempotentOperations = new Set<OperationKey>([
  "post /api/v1/customer/bookings",
  "post /api/v1/staff/bookings",
  "post /api/v1/customer/quotes/{quoteId}/accept",
  "post /api/v1/staff/quotes/{quoteId}/schedule",
  "post /api/v1/customer/payments/advance-checkouts",
  "post /api/v1/staff/payments/advances",
  "post /api/v1/staff/payments/{paymentId}/refunds",
]);

const unpaginatedArrayOperations = new Set<OperationKey>([
  "get /api/v1/employees/{employeeId}/skills",
  "get /api/v1/employees/{employeeId}/services",
  "get /api/v1/skills",
  "get /api/v1/employee-levels",
  "get /api/v1/notifications/push-subscriptions",
]);

const explicitStatusByOperation: Partial<Record<OperationKey, number>> = {
  "post /api/v1/auth/password/forgot": 202,
  "post /api/v1/auth/email-verification/request": 202,
  "post /api/v1/employees/{employeeId}/account": 201,
  "post /api/v1/staff/quotes/{quoteId}/schedule": 201,
  "post /api/v1/staff/payments/{paymentId}/refunds": 201,
};

const replayAwareOperations = new Set<OperationKey>([
  "post /api/v1/customer/bookings",
  "post /api/v1/staff/bookings",
  "post /api/v1/staff/quotes/{quoteId}/schedule",
]);

interface ResponseShape {
  schema: ResponseSchemaName;
  key?: string;
}

const responseShapeFor = (route: ApiRoute): ResponseShape => {
  const { path, method } = route;

  if (["/health", "/healthz"].includes(path)) return { schema: "Health" };
  if (["/ready", "/readyz"].includes(path)) return { schema: "Readiness" };
  if (path.startsWith("/api/v1/auth")) {
    if (["/api/v1/auth/register/customer", "/api/v1/auth/login", "/api/v1/auth/google", "/api/v1/auth/refresh", "/api/v1/auth/password"].includes(path)) {
      return { schema: "AuthResult" };
    }
    if (path === "/api/v1/auth/me" || path === "/api/v1/auth/email-verification/confirm") {
      return { schema: "PublicUser", key: "user" };
    }
    if (path === "/api/v1/auth/sessions") return { schema: "AuthSession", key: "sessions" };
    if (path === "/api/v1/auth/password/forgot" || path === "/api/v1/auth/email-verification/request") {
      return { schema: "AuthActionResult" };
    }
    throw new Error(`OpenAPI auth response schema is missing for ${method} ${path}`);
  }
  if (path === "/api/v1/public/business") return { schema: "BusinessOverview" };
  if (path.endsWith("/business/bootstrap")) return { schema: "BusinessBootstrapResult" };
  if (path.endsWith("/business/profile")) return { schema: "BusinessProfile" };
  if (path.endsWith("/business/settings")) return { schema: "BusinessSettings" };
  if (path === "/api/v1/public/branches/{branchId}/hours") return { schema: "PublicBranchHours" };
  if (path.includes("/branches/") && path.endsWith("/hours") || path.includes("/hours/{hoursId}")) {
    return { schema: "BranchHours" };
  }
  if (path.includes("/branches") && !path.includes("/scheduling/")) return { schema: "Branch" };
  if (path.endsWith("/availability")) return { schema: "Availability" };

  if (path.includes("/catalog/categories")) return { schema: "CatalogCategory" };
  if (path.includes("/catalog/branch-services")) return { schema: "BranchService" };
  if (path.includes("/catalog/services")) return { schema: "Service" };
  if (path.includes("/catalog/products")) return { schema: "Product" };
  if (path.includes("/catalog/packages")) return { schema: "ServicePackage" };

  if (path.startsWith("/api/v1/customers")) return { schema: "Customer" };
  if (path.endsWith("/bookings/expire-holds")) return { schema: "ExpirationResult" };
  if (path.includes("/bookings/") && path.endsWith("/cancel")) return { schema: "BookingLifecycleResult" };
  if (path.includes("/bookings/") && path.endsWith("/transition")) return { schema: "BookingLifecycleResult" };
  if (path.includes("/bookings/") && path.endsWith("/external-settlement")) return { schema: "ExternalSettlementResult" };
  if (path.includes("/bookings")) return { schema: "Booking" };
  if (path.endsWith("/waitlist/expire-due")) return { schema: "ExpirationResult" };
  if (path.includes("/waitlist/") && path.endsWith("/cancel")) return { schema: "EntityStatusResult" };
  if (path.includes("/waitlist")) return { schema: "WaitlistEntry" };
  if (path.endsWith("/inquiries/expire-due")) return { schema: "ExpirationResult" };
  if (path.includes("/inquiries/") && (path.endsWith("/cancel") || path.endsWith("/reject"))) {
    return { schema: "EntityStatusResult" };
  }
  if (path.includes("/inquiries") && path.endsWith("/quotes")) return { schema: "BookingQuote" };
  if (path.includes("/inquiries")) return { schema: "BookingInquiry" };
  if (path.includes("/quotes/") && path.endsWith("/accept")) return { schema: "QuoteAcceptanceResult" };
  if (path.includes("/quotes/") && path.endsWith("/schedule")) return { schema: "QuoteScheduleResult" };
  if (path.endsWith("/quotes/expire-due")) return { schema: "ExpirationResult" };
  if (path.includes("/quotes/") && path.endsWith("/reject")) return { schema: "EntityStatusResult" };
  if (path.includes("/quotes/")) return { schema: "BookingQuote" };

  if (path.startsWith("/api/v1/admins")) {
    return method === "get" && path === "/api/v1/admins"
      ? { schema: "AdminListItem" }
      : { schema: "AdminProfile" };
  }
  if (path.startsWith("/api/v1/skills")) return { schema: "Skill" };
  if (path.startsWith("/api/v1/employee-levels")) return { schema: "EmployeeLevel" };
  if (path.includes("/employees/") && path.endsWith("/access")) return { schema: "StaffAccess" };
  if (path.includes("/employees/") && path.includes("/skills")) return { schema: "EmployeeSkill" };
  if (path.includes("/employees/") && path.includes("/services")) return { schema: "EmployeeService" };
  if (path.includes("/employees") && path.includes("/schedules")) return { schema: "EmployeeSchedule" };
  if (path.includes("/time-off")) return { schema: "TimeOff" };
  if (path.startsWith("/api/v1/employees")) {
    return method === "get" && path === "/api/v1/employees"
      ? { schema: "Employee" }
      : { schema: "EmployeeProfile" };
  }

  if (path.includes("/calendar-blocks")) return { schema: "CalendarBlock" };
  if (path.includes("/resources")) return { schema: "BookableResource" };
  if (path.includes("/payments/webhook-events")) return { schema: "PaymentWebhookEvent" };
  if (path.endsWith("/payments/advance-checkouts")) return { schema: "AdvanceCheckout" };
  if (path.includes("/payments")) return { schema: "BookingPayment" };
  if (path.startsWith("/api/v1/webhooks/payments")) return { schema: "PaymentWebhookAccepted" };

  if (path.endsWith("/notifications/preferences")) return { schema: "NotificationPreference" };
  if (path.includes("/notifications/push-subscriptions")) return { schema: "PushSubscription" };
  if (path.includes("/notifications/templates")) return { schema: "NotificationTemplate" };
  if (path.includes("/notifications/queue")) return { schema: "Notification" };

  if (path.includes("/integrations/connectors") && path.includes("/mappings")) return { schema: "ExternalEntityMapping" };
  if (path.includes("/integrations/connectors") && path.includes("/sync-jobs")) return { schema: "IntegrationSyncJob" };
  if (path.includes("/integrations/connectors")) return { schema: "ExternalConnector" };
  if (path.includes("/audit-logs")) return { schema: "AuditLog" };
  if (path.includes("/outbox")) return { schema: "OutboxEvent" };
  throw new Error(`OpenAPI response schema is missing for ${method} ${path}`);
};

const apiErrorSchema: OpenApiSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", const: false },
    error: {
      type: "object",
      properties: {
        code: { type: "string", example: "VALIDATION_ERROR" },
        message: { type: "string" },
        details: {},
        requestId: { type: "string", description: "Correlation ID; normally a UUID unless supplied by the client." },
      },
      required: ["code", "message", "requestId"],
      additionalProperties: false,
    },
  },
  required: ["success", "error"],
  additionalProperties: false,
};

const paginationMetaSchema: OpenApiSchema = {
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    total: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 1 },
    hasNextPage: { type: "boolean" },
    hasPreviousPage: { type: "boolean" },
  },
  required: ["page", "limit", "total", "totalPages", "hasNextPage", "hasPreviousPage"],
  additionalProperties: false,
};

const successEnvelope = (
  dataSchema: OpenApiSchema,
  paginated = false,
  replayAware = false,
): OpenApiSchema => ({
  type: "object",
  properties: {
    success: { type: "boolean", const: true },
    data: dataSchema,
    ...(paginated
      ? {
          meta: {
            type: "object",
            properties: { pagination: { $ref: "#/components/schemas/PaginationMeta" } },
            required: ["pagination"],
            additionalProperties: false,
          },
        }
      : replayAware
        ? {
            meta: {
              type: "object",
              properties: {
                idempotentReplay: { type: "boolean", const: true },
              },
              required: ["idempotentReplay"],
              additionalProperties: false,
            },
          }
        : {}),
  },
  required: ["success", "data", ...(paginated || replayAware ? ["meta"] : [])],
  additionalProperties: false,
});

const commonResponseHeaders = (rateLimited: boolean) => ({
  "X-Request-Id": { $ref: "#/components/headers/RequestId" },
  ...(rateLimited
    ? {
        "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
        "RateLimit-Remaining": { $ref: "#/components/headers/RateLimitRemaining" },
        "RateLimit-Reset": { $ref: "#/components/headers/RateLimitReset" },
      }
    : {}),
});

const successResponse = (
  dataSchema: OpenApiSchema,
  paginated: boolean,
  rateLimited: boolean,
  envelope = true,
  setsSessionCookies = false,
  replayAware = false,
) => ({
  description: "Successful response",
  headers: {
    ...commonResponseHeaders(rateLimited),
    ...(setsSessionCookies
      ? { "Set-Cookie": { $ref: "#/components/headers/SetCookie" } }
      : {}),
  },
  content: {
    "application/json": {
      schema: envelope
        ? successEnvelope(dataSchema, paginated, replayAware)
        : dataSchema,
    },
  },
});

const errorResponse = (description: string, rateLimited: boolean, retryAfter = false) => ({
  description,
  headers: {
    ...commonResponseHeaders(rateLimited),
    ...(retryAfter ? { "Retry-After": { $ref: "#/components/headers/RetryAfter" } } : {}),
  },
  content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
});

const pathParameterSchema = (name: string): OpenApiSchema => {
  if (name === "sessionId") return { type: "string", format: "uuid" };
  if (name === "provider") {
    return { type: "string", pattern: "^[a-z0-9][a-z0-9_-]*$", minLength: 1, maxLength: 80 };
  }
  return name.endsWith("Id")
    ? { type: "string", pattern: objectIdPattern }
    : { type: "string" };
};

const extractPathParameters = (path: string) =>
  [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: pathParameterSchema(match[1] ?? ""),
  }));

const queryDescriptions: Record<string, string> = {
  page: "One-based page number.",
  limit: "Items per page; maximum 100.",
  sort: "Sort field. Prefix with '-' for descending order.",
  search: "Case-insensitive text search.",
  from: "Inclusive range start as an ISO 8601 timestamp with offset.",
  to: "Exclusive range end as an ISO 8601 timestamp with offset.",
};

const queryParameters = (schemaName: InputSchemaName | undefined) => {
  if (!schemaName) return [];
  const schema = inputSchemas[schemaName];
  const properties = (schema.properties ?? {}) as Record<string, OpenApiSchema>;
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === "string")
      : [],
  );
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: "query",
    required: required.has(name),
    ...(queryDescriptions[name] ? { description: queryDescriptions[name] } : {}),
    schema: propertySchema,
  }));
};

const securityFor = (mode: SecurityMode = "auth") =>
  mode === "public" ? [] : [{ bearerAuth: [] }];

const requestBodyFor = (route: ApiRoute, schemaName: InputSchemaName | undefined) => {
  if (route.webhook) {
    return {
      required: true,
      description: "Exact raw provider payload. Signature verification is adapter-specific.",
      content: {
        "application/json": { schema: { type: "object", additionalProperties: true } },
        "text/plain": { schema: { type: "string" } },
        "application/octet-stream": { schema: { type: "string", format: "binary" } },
      },
    };
  }
  if (!schemaName) return undefined;
  return {
    required: operationKey(route) !== "post /api/v1/auth/refresh",
    content: {
      "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
    },
  };
};

const resolveBodySchema = (route: ApiRoute): InputSchemaName | undefined => {
  const override = bodySchemaByOperation[operationKey(route)];
  if (override) return override;
  if (!route.bodySchema) return undefined;
  if (route.bodySchema in inputSchemas) return route.bodySchema as InputSchemaName;
  throw new Error(`OpenAPI request body schema is missing for ${operationKey(route)}`);
};

const resolveDataSchema = (
  route: ApiRoute,
  paginated: boolean,
  arrayResponse: boolean,
): OpenApiSchema => {
  const responseShape = responseShapeFor(route);
  let schema: OpenApiSchema = { $ref: `#/components/schemas/${responseShape.schema}` };
  if (paginated || arrayResponse || responseShape.key === "sessions") {
    schema = { type: "array", items: schema };
  }
  if (responseShape.key) {
    schema = {
      type: "object",
      properties: { [responseShape.key]: schema },
      required: [responseShape.key],
      additionalProperties: false,
    };
  }
  return schema;
};

const systemRoutes: ApiRoute[] = [
  { method: "get", path: "/health", tag: "System", summary: "Liveness check", security: "public" },
  { method: "get", path: "/healthz", tag: "System", summary: "Liveness check alias", security: "public" },
  { method: "get", path: "/ready", tag: "System", summary: "MongoDB and Redis readiness check", security: "public" },
  { method: "get", path: "/readyz", tag: "System", summary: "Readiness check alias", security: "public" },
];

const documentedRoutes = [...systemRoutes, ...routes];
const seenOperations = new Set<OperationKey>();
const paths: Record<string, Record<string, unknown>> = {};

for (const route of documentedRoutes) {
  const key = operationKey(route);
  if (seenOperations.has(key)) throw new Error(`Duplicate OpenAPI operation: ${key}`);
  seenOperations.add(key);

  const querySchemaName = route.query
    ? querySchemaByPath[route.path]
    : undefined;
  if (route.query && !querySchemaName) {
    throw new Error(`OpenAPI query schema is missing for ${key}`);
  }
  const bodySchemaName = resolveBodySchema(route);
  const requestBody = requestBodyFor(route, bodySchemaName);
  const paginated = querySchemaName
    ? paginatedQuerySchemas.has(querySchemaName)
    : false;
  const arrayResponse = unpaginatedArrayOperations.has(key);
  const noContent = noContentOperations.has(key);
  const rateLimited = route.path.startsWith("/api/v1/");
  const systemResponse = !rateLimited;
  const setsSessionCookies = !noContent && responseShapeFor(route).schema === "AuthResult";
  const replayAware = replayAwareOperations.has(key);
  const statusCode = noContent
    ? 204
    : (explicitStatusByOperation[key] ?? route.statusCode ?? 200);
  const parameters = [
    { $ref: "#/components/parameters/RequestId" },
    ...extractPathParameters(route.path),
    ...queryParameters(querySchemaName),
    ...(idempotentOperations.has(key)
      ? [{ $ref: "#/components/parameters/IdempotencyKey" }]
      : []),
    ...(key === "post /api/v1/auth/refresh"
      ? [{ $ref: "#/components/parameters/CsrfToken" }]
      : []),
  ];
  const responses: Record<string, unknown> = {
    [statusCode]: noContent
      ? { description: "Completed successfully; no response body.", headers: commonResponseHeaders(rateLimited) }
      : successResponse(
          resolveDataSchema(route, paginated, arrayResponse),
          paginated,
          rateLimited,
          !systemResponse,
          setsSessionCookies,
          replayAware && statusCode === 200,
        ),
    400: errorResponse("Malformed request, validation failure, or missing idempotency key", rateLimited),
    ...(route.security === "public"
      ? {}
      : { 401: errorResponse("Authentication required or token invalid", rateLimited) }),
    ...(route.security === "public"
      ? {}
      : { 403: errorResponse("Role, permission, CSRF, or branch access denied", rateLimited) }),
    404: errorResponse("Route or resource not found", rateLimited),
    409: errorResponse("Duplicate, stale-version, state, idempotency, or booking conflict", rateLimited),
    ...(requestBody ? { 413: errorResponse("Request body exceeds REQUEST_BODY_LIMIT", rateLimited) } : {}),
    ...(requestBody ? { 415: errorResponse("Request media type, charset, or encoding is unsupported", rateLimited) } : {}),
    ...(rateLimited
      ? { 429: errorResponse("Rate limit exceeded", true, true) }
      : {}),
    500: errorResponse("Unexpected internal server error", rateLimited),
    503: errorResponse("MongoDB, Redis, provider, configuration, or request-protection dependency unavailable", rateLimited),
  };
  if (route.path === "/ready" || route.path === "/readyz") {
    responses["503"] = {
      description: "One or more required dependencies are not ready.",
      headers: commonResponseHeaders(false),
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Readiness" },
        },
      },
    };
  }
  if (replayAware && statusCode === 201) {
    responses["200"] = successResponse(
      resolveDataSchema(route, paginated, arrayResponse),
      false,
      rateLimited,
      true,
      false,
      true,
    );
  }

  const operation = {
    tags: [route.tag],
    summary: route.summary,
    operationId: `${route.method}_${route.path
      .replace(/^\/api\/v1\//, "")
      .replace(/^\//, "")
      .replace(/[{}]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")}`,
    security: securityFor(route.security),
    parameters,
    ...(requestBody ? { requestBody } : {}),
    responses,
  };

  paths[route.path] = { ...(paths[route.path] ?? {}), [route.method]: operation };
}

export const openApiDocument = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "Salon Booking API",
    version: "1.1.0",
    description:
      "Single-salon, optional multi-branch booking API. Request components are generated from the same Zod schemas used by Express. Monetary values use integer minor units, timestamps are UTC ISO 8601 values, local calendar dates use YYYY-MM-DD, and business display/scheduling uses the configured IANA time zone.",
    contact: { name: "PrimeX" },
  },
  servers: [
    { url: `http://localhost:${config.PORT}`, description: "Local development server" },
    { url: "/", description: "Same-origin deployment" },
  ],
  tags: [
    { name: "System", description: "Liveness and dependency readiness" },
    { name: "Auth", description: "Customer, employee, and admin authentication" },
    { name: "Public", description: "Public salon, branch, and availability APIs" },
    { name: "Public Catalog", description: "Public services, products, and packages" },
    { name: "Customers", description: "Customer profile and CRM APIs" },
    { name: "Customer Bookings", description: "Customer direct booking and waitlist APIs" },
    { name: "Customer Inquiries", description: "Customer quote/inquiry APIs" },
    { name: "Staff Bookings", description: "Permission- and branch-scoped staff booking operations" },
    { name: "Staff Inquiries", description: "Permission- and branch-scoped quote/inquiry operations" },
    { name: "Business Admin", description: "Single salon profile, settings, branches, and hours" },
    { name: "Catalog Admin", description: "Services, retail products, packages, and branch service setup" },
    { name: "Staff Admin", description: "Admins, employees, skills, levels, and access policy" },
    { name: "Employee Self Service", description: "Employee profile, assigned bookings, and time off" },
    { name: "Scheduling Admin", description: "Schedules, resources, time off, and calendar blocks" },
    { name: "Payments", description: "Booking advance payment and refund APIs only" },
    { name: "Webhooks", description: "Signed provider webhook ingestion" },
    { name: "Notifications", description: "Self-service notification preferences and push subscriptions" },
    { name: "Notifications Admin", description: "Notification queue and template management" },
    { name: "Integrations", description: "Optional external ERP/POS connector and sync metadata" },
    { name: "Operations", description: "Audit and transactional outbox operations" },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Short-lived access token returned by login, Google login, registration, password change, or refresh.",
      },
      refreshCookie: {
        type: "apiKey",
        in: "cookie",
        name: config.AUTH_REFRESH_COOKIE_NAME,
        description: "HttpOnly refresh cookie. Browser refresh also requires the X-CSRF-Token header.",
      },
    },
    parameters: {
      RequestId: {
        name: "X-Request-Id",
        in: "header",
        required: false,
        description: "Optional caller correlation ID. Invalid values are replaced by a generated UUID.",
        schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        description: "Required replay-safe operation key. Reusing it with different input returns 409.",
        schema: { type: "string", minLength: 8, maxLength: 200 },
      },
      CsrfToken: {
        name: "X-CSRF-Token",
        in: "header",
        required: false,
        description: "Required only when refreshToken is read from the HttpOnly cookie; copy the readable CSRF cookie/authentication.csrfToken value.",
        schema: { type: "string" },
      },
    },
    headers: {
      RequestId: { description: "Correlation ID for logs and support.", schema: { type: "string" } },
      RateLimitLimit: { description: "Maximum requests in the current window.", schema: { type: "integer" } },
      RateLimitRemaining: { description: "Requests remaining in the current window.", schema: { type: "integer", minimum: 0 } },
      RateLimitReset: { description: "Unix timestamp when the current rate-limit window resets.", schema: { type: "integer" } },
      RetryAfter: { description: "Seconds before a rate-limited request should be retried.", schema: { type: "integer", minimum: 1 } },
      SetCookie: { description: "Refresh and CSRF cookies. Browsers must send credentials on later auth requests.", schema: { type: "string" } },
    },
    schemas: {
      ApiError: apiErrorSchema,
      PaginationMeta: paginationMetaSchema,
      ...inputSchemas,
      ...responseSchemas,
    },
  },
} as const;
