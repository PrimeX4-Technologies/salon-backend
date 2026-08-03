# Salon Backend — Setup, Initialization, and API Test Order

This is a single-salon booking platform. The salon may operate with one branch or multiple branches. It is not a POS or accounting system. It manages customer discovery, catalog presentation, staff capability, availability, bookings, inquiries/quotes, optional booking advances, notifications, schedules, and optional synchronization metadata for an external ERP/POS.

Use this guide for a new development database, a clean test environment, or the first production deployment.

## 1. Required services and tools

- Node.js 22 or newer and npm 10 or newer.
- MongoDB.
- Redis.
- `curl` and optionally `jq` for command-line API tests.
- A MongoDB replica set or sharded cluster in production. Transactions are required for production booking, payment, and configuration correctness.

Redis is required, not optional. It stores sessions, one-time action tokens, rate-limit counters, distributed locks, and booking-configuration leases.

## 2. Install and configure

From the repository root:

```bash
npm install
cp .env.example .env
```

The npm warning about `allowScripts` is a supply-chain safety prompt. Review packages before allowing scripts. `bcrypt` needs its native build and `esbuild` is used by `tsx`; `@scarf/scarf` is telemetry-related and is not required for application behavior.

For npm versions that enforce script approval, review the pending list and approve only packages you trust:

```bash
npm approve-scripts --allow-scripts-pending
```

Generate three different secrets and place them in `.env`:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Generate a new value for each of:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `AUTH_ACTION_TOKEN_SECRET`

If payment checkout payloads or push tokens will be stored, also generate `DATA_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The default business time zone is `Asia/Colombo`. Dates stored as MongoDB `Date` values remain UTC instants; branch hours and calendar-day calculations use the configured `TZ` value consistently.

## 3. Clean-database command order

There is intentionally no fake catalog/customer seed. A real salon's branches, services, products, packages, employees, and hours must be created through the validated API. The two initialization commands are index creation and first-admin bootstrap.

For development, run this order:

```bash
npm run check
npm run db:indexes:dev
npm run bootstrap:admin
npm run dev
```

In a second terminal, start the asynchronous worker:

```bash
npm run worker:operations
```

Why this order:

1. `npm run check` catches TypeScript, lint, and test failures before data is changed.
2. `npm run db:indexes:dev` creates unique, partial, lookup, idempotency, and lifecycle indexes before live writes begin.
3. `npm run bootstrap:admin` creates the only unauthenticated initial admin and full `StaffAccess` record. It refuses to run when an admin already exists.
4. `npm run dev` starts the HTTP API.
5. `npm run worker:operations` processes outbox, notifications, integrations, payment webhooks, and booking lifecycle jobs.

After `bootstrap:admin` succeeds, immediately remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env`. Additional admins must be created through the protected admin API.

Do not repeatedly run the bootstrap command. It is not a normal seed and is designed for first deployment only.

## 4. Verify the processes

Default URLs:

- Liveness: `http://localhost:5000/health`
- Dependency readiness: `http://localhost:5000/ready`
- Swagger UI: `http://localhost:5000/docs/`
- OpenAPI JSON: `http://localhost:5000/openapi.json`
- Versioned OpenAPI alias: `http://localhost:5000/api/v1/openapi.json`

Checks:

```bash
curl -i http://localhost:5000/health
curl -i http://localhost:5000/ready
curl -o openapi.json http://localhost:5000/openapi.json
```

To export the same contract while the API is stopped:

```bash
npm run docs:export
```

`/health` proves the process is alive. `/ready` returns `200` only when MongoDB and Redis are both ready; otherwise it returns `503` with the dependency states.

Import `http://localhost:5000/openapi.json` into Postman as an OpenAPI definition. Swagger's **Authorize** button accepts the access token without the `Bearer ` prefix.

## 5. Authentication rules

- Customers may use email/password, mobile/password, or Google ID-token authentication when enabled in business settings.
- Admins and employees use only email/mobile plus password.
- Google authentication is customer-only.
- Access JWTs are short lived.
- Refresh sessions rotate. The server normally sends the refresh token as an HttpOnly cookie and a CSRF token as both a readable cookie and `data.authentication.csrfToken`.
- Browser clients must use `credentials: "include"` for login, refresh, and logout.
- Cookie-based refresh must send `X-CSRF-Token` using the current CSRF value.
- A successful refresh rotates both tokens and the CSRF token. Replace old values immediately.
- Staff permissions and branch scope come from the server-side `StaffAccess` document; clients cannot grant themselves access using headers or request bodies.

Set a local shell base URL:

```bash
API_BASE=http://localhost:5000/api/v1
```

Login as the bootstrap admin and keep cookies:

```bash
curl -sS -c admin.cookies \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@example.com","password":"YOUR_BOOTSTRAP_PASSWORD"}' \
  "$API_BASE/auth/login" | tee admin-login.json
```

If `jq` is installed:

```bash
ADMIN_TOKEN=$(jq -r '.data.authentication.accessToken' admin-login.json)
CSRF_TOKEN=$(jq -r '.data.authentication.csrfToken' admin-login.json)
```

Use the access token on protected calls:

```bash
-H "Authorization: Bearer $ADMIN_TOKEN"
```

Refresh using cookies:

```bash
curl -sS -b admin.cookies -c admin.cookies \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' \
  "$API_BASE/auth/refresh"
```

Non-browser or trusted native clients may send `refreshToken` in the JSON body only when the deployment returns/provides it securely. Do not store refresh tokens in browser local storage.

## 6. One-time business initialization

After the initial admin logs in, the first protected API call is business bootstrap:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "profile": {
      "name": "Prime Salon",
      "legalName": "Prime Salon (Pvt) Ltd",
      "slug": "prime-salon",
      "status": "active",
      "email": "hello@primesalon.lk",
      "phone": "+94112345678"
    },
    "primaryBranch": {
      "name": "Colombo Main",
      "code": "CMB01",
      "phone": "+94112345678",
      "isPrimary": true,
      "isActive": true,
      "bookingsEnabled": true
    },
    "settings": {
      "branchMode": "single",
      "locale": "en-LK",
      "currency": "LKR",
      "finalPaymentHandling": "external_system",
      "booking": {
        "slotIntervalMinutes": 15,
        "minimumNoticeMinutes": 60,
        "maximumAdvanceDays": 90,
        "temporaryHoldMinutes": 10,
        "cancellationWindowHours": 24,
        "allowWalkIns": true,
        "allowWaitlist": true,
        "allowProcessingOverlap": false
      },
      "customerAuth": {
        "emailPasswordEnabled": true,
        "phonePasswordEnabled": true,
        "googleEnabled": true
      },
      "defaultAdvance": {
        "requirement": "none",
        "calculation": "none",
        "basis": "estimate"
      },
      "reminders": {
        "enabled": true,
        "leadMinutes": [1440, 120],
        "channels": ["email"]
      }
    }
  }' \
  "$API_BASE/admin/business/bootstrap" | tee business-bootstrap.json
```

Save these IDs from the response:

```bash
BRANCH_ID=$(jq -r '.data.branch._id' business-bootstrap.json)
```

Business bootstrap is a one-time transaction. A second call correctly returns a conflict.

For a multi-branch salon, first change `branchMode` to `multiple`, then create another branch. Do not create a second active branch while settings remain in `single` mode.

## 7. Admin configuration order

This dependency order avoids missing-reference and availability errors.

### 7.1 Business profile and settings

Use these after bootstrap for later changes:

- `GET /admin/business/profile`
- `PUT /admin/business/profile`
- `GET /admin/business/settings`
- `PUT /admin/business/settings`
- `GET|POST /admin/branches`
- `GET|PATCH|DELETE /admin/branches/{branchId}`

### 7.2 Branch hours

Create a complete seven-day hours version. `dayOfWeek` uses `0` for Sunday through `6` for Saturday. Closed days require an empty `intervals` array; open days require at least one non-overlapping interval.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Normal Hours",
    "effectiveFrom": "2026-08-01",
    "days": [
      {"dayOfWeek":0,"isClosed":true,"intervals":[]},
      {"dayOfWeek":1,"isClosed":false,"intervals":[{"start":"09:00","end":"18:00"}]},
      {"dayOfWeek":2,"isClosed":false,"intervals":[{"start":"09:00","end":"18:00"}]},
      {"dayOfWeek":3,"isClosed":false,"intervals":[{"start":"09:00","end":"18:00"}]},
      {"dayOfWeek":4,"isClosed":false,"intervals":[{"start":"09:00","end":"18:00"}]},
      {"dayOfWeek":5,"isClosed":false,"intervals":[{"start":"09:00","end":"18:00"}]},
      {"dayOfWeek":6,"isClosed":false,"intervals":[{"start":"09:00","end":"17:00"}]}
    ],
    "status": "active"
  }' \
  "$API_BASE/admin/branches/$BRANCH_ID/hours"
```

Relevant endpoints:

- `GET|POST /admin/branches/{branchId}/hours`
- `GET|PATCH|DELETE /admin/branches/{branchId}/hours/{hoursId}`
- Public current hours: `GET /public/branches/{branchId}/hours?effectiveOn=YYYY-MM-DD`

### 7.3 Catalog categories

Create categories before services, products, or packages:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Hair","slug":"hair","appliesTo":["service","product","package"],"sortOrder":10,"isActive":true}' \
  "$API_BASE/admin/catalog/categories" | tee category.json

CATEGORY_ID=$(jq -r '.data._id' category.json)
```

### 7.4 Skills and employee levels

Create reusable skills and levels before assigning them to services/employees:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Hair Cutting","code":"HAIR_CUT","description":"Professional cutting","isActive":true}' \
  "$API_BASE/skills" | tee skill.json

SKILL_ID=$(jq -r '.data._id' skill.json)

curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Senior Stylist","code":"SENIOR","rank":100,"isActive":true}' \
  "$API_BASE/employee-levels" | tee level.json

LEVEL_ID=$(jq -r '.data._id' level.json)
```

### 7.5 Services, products, packages, and branch service availability

Service prices support:

- `fixed`
- `starting_from` for displays such as `LKR 3000+`
- `range`
- `quote_required`

Amounts use minor units. For LKR, `300000` represents LKR 3,000.00.

Create a service:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"categoryId\":\"$CATEGORY_ID\",
    \"code\":\"CUT01\",
    \"name\":\"Signature Haircut\",
    \"slug\":\"signature-haircut\",
    \"targetClientGender\":\"all\",
    \"requiredSkillIds\":[\"$SKILL_ID\"],
    \"duration\":{
      \"applicationMinutes\":45,
      \"processingMinutes\":0,
      \"finishingMinutes\":15,
      \"bufferMinutes\":10,
      \"processingBlocksEmployee\":true
    },
    \"price\":{\"mode\":\"starting_from\",\"currency\":\"LKR\",\"fromAmountMinor\":300000,\"label\":\"LKR 3,000+\"},
    \"bookingMode\":\"instant\",
    \"isActive\":true,
    \"isOnlineBookable\":true,
    \"sortOrder\":10
  }" \
  "$API_BASE/admin/catalog/services" | tee service.json

SERVICE_ID=$(jq -r '.data._id' service.json)
```

Make the service available at the branch. A global service is not bookable at a branch until this assignment exists:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$BRANCH_ID\",\"serviceId\":\"$SERVICE_ID\",\"isActive\":true,\"isOnlineBookable\":true}" \
  "$API_BASE/admin/catalog/branch-services"
```

Catalog endpoint groups:

- `/admin/catalog/categories`
- `/admin/catalog/services`
- `/admin/catalog/products`
- `/admin/catalog/packages`
- `/admin/catalog/branch-services`

Each collection supports `GET` and `POST`; item routes support `GET`, `PATCH`, and `DELETE`.

Products represent retail items such as creams, shampoos, and keratin products. Products are presented for in-store purchase, external-link purchase, or inquiry; this backend does not implement inventory or POS checkout.

Packages represent bundles, weddings, and events. They use `request_quote` or `consultation_required`; they are handled through inquiry and quote APIs rather than direct booking items.

### 7.6 Employees, login access, skills, and service capability

Create employees only after branches and optional levels exist. An employee can be created as invited without an account, or as active with a local account. An active employee must have a branch and local login account.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"employeeCode\":\"EMP001\",
    \"name\":\"Kasuni Silva\",
    \"title\":\"Senior Stylist\",
    \"levelId\":\"$LEVEL_ID\",
    \"workEmail\":\"kasuni@example.com\",
    \"branchIds\":[\"$BRANCH_ID\"],
    \"primaryBranchId\":\"$BRANCH_ID\",
    \"employmentType\":\"full_time\",
    \"status\":\"active\",
    \"isBookable\":true,
    \"acceptsOnlineBookings\":true,
    \"servesClientGender\":\"all\",
    \"maxConcurrentClients\":1,
    \"calendarColor\":\"#2563EB\",
    \"hireDate\":\"2026-08-01\",
    \"account\":{
      \"name\":\"Kasuni Silva\",
      \"email\":\"kasuni@example.com\",
      \"password\":\"StrongEmployee123\"
    },
    \"access\":{
      \"permissions\":[],
      \"allBranches\":false,
      \"branchIds\":[\"$BRANCH_ID\"],
      \"status\":\"active\"
    }
  }" \
  "$API_BASE/employees" | tee employee.json

EMPLOYEE_ID=$(jq -r '.data.employee._id' employee.json)
```

Assign the skill:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"proficiency":"advanced","isActive":true}' \
  "$API_BASE/employees/$EMPLOYEE_ID/skills/$SKILL_ID"
```

Assign the service at the branch:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"proficiency":"advanced","isActive":true,"isOnlineBookable":true}' \
  "$API_BASE/employees/$EMPLOYEE_ID/services/$SERVICE_ID/branches/$BRANCH_ID"
```

An employee appears in public availability only when all applicable conditions pass: active branch, enabled bookings, active/published service, active branch service, active/bookable employee, online booking enabled, compatible client-gender policy, required skills, active service assignment, working schedule, no approved time off/block, and sufficient resource capacity.

### 7.7 Employee schedules

Create a complete seven-day schedule. Every break must be inside a shift and intervals cannot overlap.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Normal Roster",
    "effectiveFrom":"2026-08-01",
    "days":[
      {"dayOfWeek":0,"shifts":[],"breaks":[]},
      {"dayOfWeek":1,"shifts":[{"start":"09:00","end":"18:00"}],"breaks":[{"start":"13:00","end":"14:00"}]},
      {"dayOfWeek":2,"shifts":[{"start":"09:00","end":"18:00"}],"breaks":[{"start":"13:00","end":"14:00"}]},
      {"dayOfWeek":3,"shifts":[{"start":"09:00","end":"18:00"}],"breaks":[{"start":"13:00","end":"14:00"}]},
      {"dayOfWeek":4,"shifts":[{"start":"09:00","end":"18:00"}],"breaks":[{"start":"13:00","end":"14:00"}]},
      {"dayOfWeek":5,"shifts":[{"start":"09:00","end":"18:00"}],"breaks":[{"start":"13:00","end":"14:00"}]},
      {"dayOfWeek":6,"shifts":[{"start":"09:00","end":"17:00"}],"breaks":[]}
    ],
    "status":"active"
  }' \
  "$API_BASE/admin/scheduling/branches/$BRANCH_ID/employees/$EMPLOYEE_ID/schedules"
```

Then configure optional physical capacity:

- `GET|POST /admin/scheduling/branches/{branchId}/resources`
- `GET|PATCH|DELETE /admin/scheduling/branches/{branchId}/resources/{resourceId}`
- `GET|POST /admin/scheduling/branches/{branchId}/calendar-blocks`
- `GET|PATCH|DELETE /admin/scheduling/branches/{branchId}/calendar-blocks/{blockId}`
- `GET /admin/scheduling/time-off`
- `POST /admin/scheduling/time-off/{timeOffId}/approve|reject|cancel`

Only create a chair/room/equipment resource when the service actually requires that constrained resource. Creating resource records makes their capacity part of availability calculations.

## 8. Public and customer test order

After admin setup, use this order to prove the customer journey.

### 8.1 Test public discovery

1. `GET /public/business`
2. `GET /public/branches`
3. `GET /public/branches/{branchId}`
4. `GET /public/branches/{branchId}/hours`
5. `GET /public/catalog/categories`
6. `GET /public/catalog/services?branchId={branchId}`
7. `GET /public/catalog/products?branchId={branchId}`
8. `GET /public/catalog/packages?branchId={branchId}`
9. `GET /public/availability?branchId={branchId}&serviceId={serviceId}&date=YYYY-MM-DD`

Use a date inside `maximumAdvanceDays`, after the minimum-notice window, and covered by active branch/employee schedules.

### 8.2 Register a customer

```bash
curl -sS -c customer.cookies \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nimali Perera","email":"nimali@example.com","phone":"+94771234567","password":"StrongCustomer123"}' \
  "$API_BASE/auth/register/customer" | tee customer-auth.json

CUSTOMER_TOKEN=$(jq -r '.data.authentication.accessToken' customer-auth.json)
```

Customer account/profile endpoints:

- `GET /auth/me`
- `GET|PATCH /customers/me`
- `GET /auth/sessions`
- `DELETE /auth/sessions/{sessionId}`
- `PATCH /auth/password`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `POST /auth/email-verification/request`
- `POST /auth/email-verification/confirm`
- `POST /auth/logout`
- `POST /auth/logout-all`

For Google login, the frontend obtains a Google **ID token**, then sends it to `POST /auth/google`. Do not send a Google authorization code to this endpoint.

### 8.3 Create a direct service booking

First call public availability. Use the exact `startAt` returned for the selected employee.

Booking creation requires an `Idempotency-Key` header between 8 and 200 characters:

```bash
curl -sS \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: customer-booking-test-0001' \
  -d "{
    \"branchId\":\"$BRANCH_ID\",
    \"items\":[{
      \"serviceId\":\"$SERVICE_ID\",
      \"employeeId\":\"$EMPLOYEE_ID\",
      \"startAt\":\"2026-08-10T10:00:00+05:30\"
    }],
    \"customerAcceptedVariablePricing\":true,
    \"customerNote\":\"Please call if the stylist is delayed\"
  }" \
  "$API_BASE/customer/bookings" | tee booking.json
```

Use a unique key for a new logical operation. Retry the same request with the same key after a timeout. Reusing a key with changed content returns `409`.

Customer booking endpoints:

- `GET|POST /customer/bookings`
- `GET /customer/bookings/{bookingId}`
- `POST /customer/bookings/{bookingId}/cancel`
- `POST /customer/bookings/{bookingId}/reschedule`
- `GET|POST /customer/waitlist`
- `GET /customer/waitlist/{waitlistEntryId}`
- `POST /customer/waitlist/{waitlistEntryId}/cancel`

Public availability is a read, not a reservation. Only successful booking creation holds/confirms the selected capacity.

### 8.4 Test packages, weddings, events, and quote-required work

These use the inquiry flow:

1. Customer: `POST /customer/inquiries`.
2. Staff: `POST /staff/inquiries/{inquiryId}/review`.
3. Staff: `POST /staff/inquiries/{inquiryId}/quotes`.
4. Staff: `POST /staff/quotes/{quoteId}/send`.
5. Customer: `POST /customer/quotes/{quoteId}/accept` with `Idempotency-Key`.
6. If a complete slot was quoted, a booking may be created automatically.
7. Otherwise staff uses `POST /staff/quotes/{quoteId}/schedule` with the selected items and an `Idempotency-Key`.

Customer may instead use `POST /customer/quotes/{quoteId}/reject`. Staff may reject an inquiry. Expiry endpoints exist for controlled operations, while the operations worker handles normal lifecycle processing.

## 9. Payment/advance test order

This backend records only booking-related advances and advance refunds. Final service amount, POS sale, inventory, accounting, taxes, and invoicing remain in the external shop system.

Advance policy can be `none`, `optional`, or `required`. A required advance places a booking in `pending_advance` with a temporary hold. An optional advance does not block confirmation.

Customer online flow:

1. Register a payment provider adapter in application code.
2. Configure `DATA_ENCRYPTION_KEY`.
3. Create an eligible booking.
4. Call `POST /customer/payments/advance-checkouts` with `Idempotency-Key`.
5. Complete checkout at the provider.
6. Provider calls `POST /webhooks/payments/{provider}` with its signed raw payload.
7. Run the payment webhook worker (included in `worker:operations`).
8. Verify with `GET /customer/payments` and `GET /customer/payments/{paymentId}`.

Staff/manual or externally verified flow:

- `POST /staff/payments/advances` with `Idempotency-Key`.
- `POST /staff/payments/{paymentId}/refunds` with `Idempotency-Key`.
- `GET /staff/payments` and `GET /staff/payments/{paymentId}`.
- Admin troubleshooting: `GET /staff/payments/webhook-events` and `POST /staff/payments/webhook-events/{webhookEventId}/retry`.

Do not mark an online provider payment successful only because a browser redirects back. Provider verification/webhook processing is the source of payment evidence.

## 10. Employee test order

1. Admin creates/provisions the employee account and active `StaffAccess`.
2. Employee logs in with email/mobile and password using `POST /auth/login`.
3. Employee reads `GET /employees/me`.
4. Employee may update allowed self-service fields with `PATCH /employees/me`.
5. Employee reads assigned work using `GET /employees/me/bookings` and `/employees/me/bookings/{bookingId}`.
6. Employee reads or requests time off through `GET|POST /employees/me/time-off`.
7. Employee may cancel a request with `POST /employees/me/time-off/{timeOffId}/cancel`.
8. An authorized scheduler approves/rejects it through admin scheduling endpoints.

Employee self-service intentionally does not grant customer CRM, staff administration, catalog management, booking management, or payment visibility unless the employee's server-side permissions explicitly grant those capabilities.

## 11. Staff booking lifecycle test

An account with `manage_bookings` and branch access can use:

- `GET|POST /staff/bookings`
- `GET /staff/bookings/{bookingId}`
- `POST /staff/bookings/{bookingId}/transition`
- `POST /staff/bookings/{bookingId}/cancel`
- `POST /staff/bookings/{bookingId}/reschedule`
- `PUT /staff/bookings/{bookingId}/external-settlement`

The normal status progression is:

```text
requested / pending_advance -> confirmed -> checked_in -> in_progress -> completed
                                      \-> cancelled
                                      \-> no_show
```

External settlement metadata reports what the ERP/POS says happened after service. It is not a local invoice or accounting ledger.

## 12. Notifications

User self-service:

- `GET|PUT /notifications/preferences`
- `GET|POST /notifications/push-subscriptions`
- `DELETE /notifications/push-subscriptions/{subscriptionId}`

Admin/staff with `manage_notifications`:

- `GET /admin/notifications/queue`
- `POST /admin/notifications/queue/{notificationId}/retry`
- `POST /admin/notifications/queue/{notificationId}/cancel`
- `GET|POST /admin/notifications/templates`
- `GET|PATCH|DELETE /admin/notifications/templates/{templateId}`

Templates/preferences alone do not deliver messages. Provider adapters must be registered and the notification worker must run.

## 13. Optional ERP/POS integration

The salon backend works without an ERP/POS. If no connector is needed, skip this entire section.

When an existing shop system is connected:

1. Implement/register an integration provider adapter.
2. Store credentials in a supported secret manager and send only its `secretReference`; never send raw secrets to the connector API.
3. Create a connector with `POST /admin/integrations/connectors`.
4. Activate it with `PUT /admin/integrations/connectors/{connectorId}/status`.
5. Create/upsert external ID mappings with `PUT /admin/integrations/connectors/{connectorId}/mappings`.
6. Enqueue explicit sync work with `POST /admin/integrations/connectors/{connectorId}/sync-jobs`.
7. Run `worker:integrations` or the combined operations worker.
8. Inspect `/mappings` and `/sync-jobs`; resolve conflicts using the explicit source of truth.

Saving an external database primary key is handled through `ExternalEntityMapping`. Local MongoDB IDs remain the booking backend's identifiers, allowing the same backend to work for salons with no external software.

Connector configuration does not automatically invent polling. A scheduler/deployment must enqueue recurring jobs when polling is desired.

## 14. Operations and troubleshooting

Admin operational endpoints:

- `GET /admin/audit-logs`
- `GET /admin/outbox`
- `POST /admin/outbox/{outboxEventId}/retry`

Worker commands:

```bash
npm run worker:operations
npm run worker:outbox
npm run worker:notifications
npm run worker:integrations
npm run worker:payment-webhooks
npm run worker:booking-lifecycle
```

Run either the combined worker or independently scaled worker kinds. Do not run both combined and separate kinds unintentionally unless duplicate consumers are expected and monitored. Locks/idempotency reduce duplicate work, but unnecessary duplicate workers add load.

Every response includes `X-Request-Id`. Include it when reporting an error. API responses use:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [],
    "requestId": "correlation-id"
  }
}
```

Common status meanings:

- `400`: malformed JSON, validation error, unsafe key, invalid ID, or missing idempotency key.
- `401`: missing/expired/invalid access token.
- `403`: role, permission, branch, CSRF, or business-policy denial.
- `404`: route or scoped resource not found.
- `409`: duplicate, state conflict, stale version, booking conflict, or idempotency-key reuse.
- `413`: request exceeds `REQUEST_BODY_LIMIT`.
- `415`: unsupported request media type, charset, or content encoding.
- `429`: rate limit exceeded; obey `Retry-After`.
- `500`: unexpected internal failure; use `X-Request-Id` to locate logs.
- `503`: MongoDB/Redis/provider/configuration/worker protection is unavailable.

List endpoints return:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

Use `page` and `limit` (maximum 100). The OpenAPI document shows endpoint-specific filters, enums, required headers, request bodies, response resources, and all pagination parameters.

## 15. Production deployment order

Use a controlled release step:

```bash
npm ci
npm run check
npm run build
npm run db:indexes
npm run bootstrap:admin:prod
```

Run `bootstrap:admin:prod` only on the first deployment of a new database. Remove its password immediately.

Then start at least one API process and one worker process:

```bash
npm start
npm run worker:operations:prod
```

Authenticate as the bootstrap admin and call the one-time business bootstrap API. On normal later releases:

```bash
npm ci
npm run check
npm run build
npm run db:indexes
npm start
```

Do not rerun admin or business bootstrap during later deployments.

Production requirements:

- TLS reverse proxy/load balancer.
- Explicit trusted `CORS_ORIGIN` values; wildcard CORS is rejected in production.
- `AUTH_COOKIE_SECURE=true`.
- Different access, refresh, and action-token secrets.
- MongoDB replica set/sharded cluster.
- Private, authenticated, durable Redis with a safe eviction policy.
- Identical provider registration/configuration on API and worker instances.
- Backups and monitoring for MongoDB, Redis, secret manager, workers, outbox backlog, webhook failures, and notification failures.

## 16. Final smoke-test checklist

Run in this order:

1. `npm run check` passes.
2. `npm run build` passes.
3. `/health` returns `200`.
4. `/ready` returns `200`.
5. `/openapi.json` loads and `/docs/` renders.
6. Admin login works.
7. Business/profile/settings and primary branch exist.
8. Active branch hours exist for the test date.
9. Category, service, and active branch-service assignment exist.
10. Active employee has account, branch, required skill, service assignment, and active schedule.
11. Public availability returns at least one slot.
12. Customer registration/login and `/customers/me` work.
13. Direct booking with `Idempotency-Key` succeeds; replay returns the same logical result.
14. Customer and employee can see only their own scoped booking views.
15. Staff transition/cancellation permissions and branch scoping are enforced.
16. Inquiry/quote flow works for wedding/event/package work.
17. Optional/required advance behavior matches business/service policy.
18. Worker processes consume outbox/lifecycle work.
19. Audit logs contain the tested mutations.
20. External connector tests are performed only when an adapter is configured.

Swagger/OpenAPI is the exhaustive endpoint reference. This document is the execution order and operational explanation.
