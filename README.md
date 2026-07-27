# Salon Booking Backend

Production-oriented booking, customer, workforce, scheduling, advance-payment, notification, and optional external-system integration API for **one salon business with one or more branches**.

The application is implemented with Node.js, Express, TypeScript, MongoDB/Mongoose, Redis, Zod, JWT access tokens, rotating refresh sessions, and asynchronous workers. The implemented HTTP surface is mounted under `/api/v1`.

This README is the implementation, frontend, and operations handoff. Route files and Zod validators remain the final source of truth for individual request fields:

- [Route composition](src/api/routes/index.ts)
- [Request validators](src/validation)
- [Additional business/catalog validators](src/api/validators)
- [Models](src/models)
- [Services](src/services)
- [Provider ports](src/ports)

## Scope and ownership

This backend owns:

- Customer authentication and salon customer profiles.
- Admin and employee identities, access, skills, levels, and service capability.
- Business settings, branches, hours, schedules, time off, calendar blocks, and bookable resources.
- Public discovery for the salon, branches, services, products, and packages.
- Availability, bookings, waitlists, event/wedding inquiries, and quotes.
- Booking advances, advance refunds, signed payment-webhook intake, and an external-settlement summary.
- Notification preferences, templates, push subscriptions, and a delivery queue.
- Optional ERP/POS/CRM/calendar synchronization through provider adapters.
- Transactional outbox events and append-only operational audit records.

It deliberately does **not** own:

- POS checkout or retail product orders.
- Inventory, stock, purchasing, or suppliers.
- Accounting, tax, invoices, or a financial ledger.
- Payroll, commission calculation, or HR payroll.
- The salon's final bill or final online payment.
- A frontend application.

Products are discoverable catalog records and can appear in inquiries/quotes. Final service pricing and settlement can be completed by the salon's existing ERP/POS. This backend only records a safe operational settlement summary when staff need to reflect that external result.

## Non-negotiable business invariant

One deployment and one MongoDB database represent exactly one salon business:

```text
one deployment + one database
└── one BusinessProfile
    ├── one BusinessSettings
    └── one or more Branch records
```

There is intentionally no `tenantId` or `salonId` on every document. Deploy a separate instance and database for another unrelated salon.

A salon without a visible branch concept still has one internal primary `Branch`. Set `branchMode` to `single`, keep that branch as `primaryBranchId`, and hide the branch selector in the frontend. A salon with multiple locations uses `branchMode: "multiple"`.

Bookings and other operational records are always branch-scoped. Customers are salon-wide: a customer's preferred branch is a preference, not ownership. `view_customers` consequently grants salon-wide CRM visibility, while branch access protects branch-specific operations.

## Runtime architecture

```text
HTTP client
   │
   ▼
Express middleware
request ID → security headers → CORS → body parsing → unsafe-key guard
→ Redis rate limit → authentication → role/permission/branch scope → Zod
   │
   ▼
thin controller
   │
   ▼
domain service
   ├── Redis session / rate limit / distributed lock / read-write lease
   ├── MongoDB transaction
   ├── repository + model
   ├── audit record
   └── transactional outbox event

separate operations process
   ├── outbox publisher
   ├── notification delivery
   ├── integration jobs
   ├── verified payment webhooks
   └── booking lifecycle expiration
```

Important implementation properties:

- API and worker startup connect to MongoDB and Redis before accepting work.
- HTTP startup and shutdown are asynchronous and handle `SIGTERM`, `SIGINT`, uncaught exceptions, and unhandled rejections.
- Health is a process liveness check; readiness reports both MongoDB and Redis.
- Controllers are transport adapters. Authorization, scoping, pricing, transitions, locks, and transactions are enforced again in services.
- Mutations that affect booking configuration use a per-branch writer lease. Availability and booking allocation use read leases so configuration cannot change midway through an allocation.
- Booking creation/rescheduling locks the affected branch day, employees, resources, and any off-site travel blocks, then rechecks availability inside the guarded operation.
- Database writes that must remain consistent use MongoDB transactions. Associated outbox and audit records are written with the same transaction where applicable.
- Workers claim records using renewable database leases and reject stale ownership.

### Repository layout

```text
src/
├── api/
│   ├── controllers/        # HTTP request/response adapters
│   ├── middlewares/        # auth, permissions, safety, rate limits, validation
│   ├── routes/             # complete API composition
│   └── validators/         # business and catalog Zod schemas
├── config/                 # validated environment, MongoDB configuration
├── models/
│   ├── access/             # StaffAccess and permission definitions
│   ├── audit/              # append-only audit trail
│   ├── auth/               # User login identity
│   ├── bookings/           # bookings, items, inquiries, quotes, waitlist
│   ├── business/           # singleton business/settings and branches
│   ├── catalog/            # categories, services, products, packages
│   ├── core/               # shared schemas, money/pricing, validation
│   ├── customers/
│   ├── events/             # transactional outbox
│   ├── integrations/
│   ├── notifications/
│   ├── payments/
│   ├── scheduling/
│   └── staff/
├── ports/                  # provider interfaces and registries
├── providers/              # deployment composition root
├── repositories/           # persistence operations
├── scripts/                # first-admin and index commands
├── services/               # domain/application logic
├── types/
├── utils/
├── validation/             # auth, people, scheduling, booking, etc. schemas
├── workers/                # asynchronous operations process
├── app.ts                  # Express composition
└── index.ts                # API process lifecycle
```

## Requirements

- Node.js 22 or newer.
- npm 10 or newer.
- MongoDB.
- Redis.

Production MongoDB **must** be a replica set or sharded cluster. The application checks this at startup because atomic booking/payment/configuration workflows require transactions. A standalone MongoDB instance is accepted only outside production, where transaction fallback is explicitly non-atomic and intended for local development or tests.

Redis is not an optional cache. It is required for:

- Active sessions and refresh-token rotation.
- One-time password-reset and email-verification tokens.
- Global and endpoint-specific rate limits.
- Booking, employee, resource, travel, and lifecycle locks.
- Booking-configuration read/write leases.

## Local setup

1. Install dependencies and create the environment file.

   ```bash
   npm install
   cp .env.example .env
   ```

2. Set independent secrets and start MongoDB and Redis.

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Generate a different value for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `AUTH_ACTION_TOKEN_SECRET`.

3. Create the first administrator **before** business bootstrap.

   ```bash
   npm run bootstrap:admin
   ```

   The command creates one local admin and active `StaffAccess` with every permission and all-branch access. It refuses to create another initial admin. Remove `BOOTSTRAP_ADMIN_PASSWORD` from the environment after successful use.

4. Start the API.

   ```bash
   npm run dev
   ```

5. Log in as the bootstrap admin, then call `POST /api/v1/admin/business/bootstrap`. That protected, one-time transaction creates the singleton business profile, primary branch, and business settings. It rejects a second bootstrap.

6. Configure branch hours, catalog, branch services, staff capability, employee schedules, resources, and optional provider adapters.

7. Create/verify indexes.

   ```bash
   npm run db:indexes:dev
   ```

8. Run the operations worker while developing asynchronous features.

   ```bash
   npm run worker:operations
   ```

The default API origin is `http://localhost:5000`. Check:

```bash
curl http://localhost:5000/health
curl http://localhost:5000/ready
```

## Environment configuration

Start from [.env.example](.env.example). Configuration is parsed at process startup; invalid security combinations fail fast.

### Infrastructure and HTTP

| Variable | Purpose | Example/default |
|---|---|---|
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `TZ` | One deployment-wide IANA timezone | `Asia/Colombo` |
| `PORT` | HTTP listen port | `5000` |
| `MONGO_URI` | MongoDB connection URI | required |
| `REDIS_URL` | Redis connection URI | required |
| `CORS_ORIGIN` | Comma-separated trusted browser origins | `http://localhost:3000` |
| `TRUST_PROXY` | Trust the first reverse proxy for IP/protocol | `false` |
| `REQUEST_BODY_LIMIT` | JSON, form, and webhook body limit | `100kb` |
| `SHUTDOWN_TIMEOUT_MS` | Maximum graceful shutdown period | `10000` |
| `API_RATE_LIMIT_WINDOW_SECONDS` | Global API limiter window | `60` |
| `API_RATE_LIMIT_MAX` | Global requests per client/window | `1000` |
| `PAYMENT_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS` | Webhook limiter window | `60` |
| `PAYMENT_WEBHOOK_RATE_LIMIT_MAX` | Webhook requests per client/window | `300` |

Production rejects wildcard CORS, requires secure cookies, and requires transactional MongoDB. Set `TRUST_PROXY=true` only when the service is behind a trusted proxy that correctly overwrites forwarding headers.

### Authentication and encryption

| Variable | Purpose | Example/default |
|---|---|---|
| `JWT_ACCESS_SECRET` | HS256 access-token secret, at least 32 bytes | required |
| `JWT_REFRESH_SECRET` | Refresh-token secret, at least 32 bytes | required |
| `JWT_ACCESS_TTL_SECONDS` | Access-token lifetime | `900` |
| `JWT_REFRESH_TTL_SECONDS` | Refresh-session lifetime | `2592000` |
| `JWT_ISSUER` | JWT issuer check | `salon-booking-api` |
| `JWT_AUDIENCE` | JWT audience check | `salon-booking-client` |
| `GOOGLE_CLIENT_ID` | Google ID-token audience for customer sign-in | optional until enabled |
| `AUTH_MAX_FAILED_ATTEMPTS` | Local-login failures before lock | `5` |
| `AUTH_LOCK_SECONDS` | Account lock duration | `900` |
| `AUTH_REFRESH_COOKIE_NAME` | HttpOnly refresh cookie name | `salon_refresh` |
| `AUTH_CSRF_COOKIE_NAME` | Readable double-submit CSRF cookie | `salon_csrf` |
| `AUTH_COOKIE_SECURE` | Send auth cookies only over HTTPS | production requires `true` |
| `AUTH_COOKIE_SAME_SITE` | `lax`, `strict`, or `none` | `lax` |
| `AUTH_RETURN_REFRESH_TOKEN` | Include refresh token in JSON for native/trusted clients | `false` |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | Sensitive auth limiter window | `900` |
| `AUTH_RATE_LIMIT_MAX` | Sensitive auth requests per client/window | `10` |
| `AUTH_ACTION_TOKEN_SECRET` | One-time action-token protection, at least 32 bytes | required |
| `AUTH_PASSWORD_RESET_TTL_SECONDS` | Reset-token lifetime | `900` |
| `AUTH_EMAIL_VERIFICATION_TTL_SECONDS` | Email-verification-token lifetime | `86400` |
| `DATA_ENCRYPTION_KEY` | Exactly 32 bytes, hex or base64url, for protected stored payloads | feature-dependent |

In production, all three auth secrets must be distinct. `AUTH_COOKIE_SAME_SITE=none` requires `AUTH_COOKIE_SECURE=true`. `DATA_ENCRYPTION_KEY` is required when using encrypted push tokens or persisted payment-webhook payloads.

### First administrator

| Variable | Purpose |
|---|---|
| `BOOTSTRAP_ADMIN_NAME` | Initial administrator's display name |
| `BOOTSTRAP_ADMIN_EMAIL` | Initial administrator's email |
| `BOOTSTRAP_ADMIN_PHONE` | Optional E.164 mobile number |
| `BOOTSTRAP_ADMIN_PASSWORD` | One-time local password; remove after bootstrap |

Concrete payment, messaging, event-bus, and ERP adapter credentials are deployment-specific and are not parsed by the core. Load them from the deployment environment or secret manager in the adapter module. Integration connector records store a secret **reference**, never the secret value.

## Commands and processes

| Command | Purpose |
|---|---|
| `npm run dev` | Watch and run `src/index.ts` with `tsx` |
| `npm run bootstrap:admin` | Development/source first-admin command |
| `npm run bootstrap:admin:prod` | Built first-admin command |
| `npm run db:indexes:dev` | Create/synchronize required indexes from source |
| `npm run db:indexes` | Built production index command |
| `npm run typecheck` | TypeScript check without emitting files |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run test` | Vitest watch mode |
| `npm run test:run` | One test run |
| `npm run check` | Typecheck, lint, then tests |
| `npm run build` | Clean and compile into `dist/` |
| `npm start` | Run the built API |

The source tree is authoritative. Do not manually edit `dist/`; `npm run build` regenerates it.

### Worker commands

| Development | Production | Work claimed |
|---|---|---|
| `npm run worker:operations` | `npm run worker:operations:prod` | All worker kinds in one process |
| `npm run worker:outbox` | `npm run worker:outbox:prod` | Transactional outbox publication |
| `npm run worker:notifications` | `npm run worker:notifications:prod` | Notification queue delivery |
| `npm run worker:integrations` | `npm run worker:integrations:prod` | Explicitly enqueued integration jobs |
| `npm run worker:payment-webhooks` | `npm run worker:payment-webhooks:prod` | Persisted, signed payment events |
| `npm run worker:booking-lifecycle` | `npm run worker:booking-lifecycle:prod` | Expired booking holds, quotes, and waitlist offers |

Use either one `all` worker process or independently scaled worker kinds. Running both patterns is safe because records are leased, but it is usually operationally simpler to choose one pattern. Every worker process requires both MongoDB and Redis and handles graceful shutdown.

## Authentication

### Identity model

`User` is the login identity and has one canonical role:

- `customer`
- `employee`
- `admin`

`Customer` and `Employee` are domain profiles, not alternative credential stores.

- Customers may register/login with email or E.164 mobile plus password.
- Customers may also sign in with a Google ID token when enabled in business settings and `GOOGLE_CLIENT_ID` is configured.
- Google sign-in verifies the configured audience and a verified Google email and always creates/links a customer role.
- Employees and admins use local email/mobile plus password only.
- There is no public employee/admin signup. Admin APIs create admins and employee profiles and provision employee accounts.
- Walk-in or externally synchronized customers may exist without a `User` login.

Passwords are bcrypt-hashed with cost 12 and limited to 72 UTF-8 bytes. New customer/reset passwords require at least eight characters, a lowercase letter, an uppercase letter, and a number. Repeated failed local logins temporarily lock the account.

### Access and refresh sessions

An access token alone is not treated as a permanent session. Each protected request verifies:

1. HS256 signature, issuer, audience, expiry, and token type.
2. The active Redis session.
3. The current active database user and token version.
4. Role, active staff access, permissions, and branch scope where required.

Refresh tokens are rotating and one-time-use. Reusing an already rotated token is treated as theft/replay: the session family is revoked, all sessions for that user are invalidated, and the token version is advanced.

Successful registration/login/refresh/password-change responses have this shape:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "..."
    },
    "authentication": {
      "accessToken": "...",
      "tokenType": "Bearer",
      "expiresIn": 900,
      "refreshExpiresIn": 2592000,
      "csrfToken": "..."
    }
  }
}
```

The server also writes:

- An HttpOnly refresh cookie scoped to `/api/v1/auth`.
- A readable CSRF cookie with the same path.

The response contains `refreshToken` only when `AUTH_RETURN_REFRESH_TOKEN=true`.

### Browser flow

1. Call login/register/Google with `credentials: "include"`.
2. Keep the short-lived access token and returned CSRF token in application memory.
3. Send protected requests with `Authorization: Bearer <accessToken>`.
4. Refresh with cookies and `X-CSRF-Token: <latest csrfToken>`.
5. Replace both in-memory tokens from every refresh response.
6. Serialize refresh requests, including across browser tabs. Two concurrent refreshes with the same one-time token can trigger reuse protection.

```ts
const API = "https://api.example.com/api/v1";

let accessToken: string | undefined;
let csrfToken: string | undefined;
let refreshInFlight: Promise<void> | undefined;

async function login(identifier: string, password: string) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const payload = await response.json();
  if (!response.ok) throw payload;
  accessToken = payload.data.authentication.accessToken;
  csrfToken = payload.data.authentication.csrfToken;
  return payload.data.user;
}

async function refreshSession() {
  refreshInFlight ??= fetch(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken ?? "",
    },
    body: "{}",
  })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw payload;
      accessToken = payload.data.authentication.accessToken;
      csrfToken = payload.data.authentication.csrfToken;
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}
```

Do not persist access or refresh tokens in browser local storage. Cross-site browser deployments normally need `AUTH_COOKIE_SAME_SITE=none`, HTTPS, `AUTH_COOKIE_SECURE=true`, an explicit `CORS_ORIGIN`, and credentialed requests.

### Native/trusted-client flow

Set `AUTH_RETURN_REFRESH_TOKEN=true` only for deployments that support non-browser clients. The client stores the returned refresh token in the operating system's secure keychain and calls:

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{"refreshToken":"..."}
```

The explicit body-token flow does not use cookie CSRF protection. Never enable response refresh tokens for a browser design that stores them in JavaScript-accessible persistent storage.

### Password reset and email verification

Action tokens are one-time Redis-backed tokens. Requests create outbox events containing the protected delivery token:

- Password-forgot always returns the same `202` response to prevent account enumeration.
- Development may return a `devToken`.
- Production needs a configured outbox publisher and downstream delivery path.
- A trusted in-process delivery adapter must decrypt the event's
  `encryptedToken` with `decryptActionToken(purpose, encryptedToken)` before
  putting the raw token in the frontend reset/verification link. Never log the
  raw token or publish it to an untrusted bus.
- Reset/password changes revoke prior sessions.

There is no phone OTP or phone-verification endpoint.

## Authorization model

Roles do not replace permissions. `StaffAccess` adds:

- `status`: `invited`, `active`, `suspended`, or `revoked`.
- `allBranches`, or an explicit non-empty `branchIds` set.
- A set of permissions.
- A required local authentication method.

Implemented staff permissions are:

| Permission | Capability |
|---|---|
| `manage_business` | Business identity and bootstrap |
| `manage_branches` | Branch records |
| `manage_staff` | Employees, admins, levels, skills, capability, access |
| `manage_catalog` | Categories, services, products, packages, branch offerings |
| `manage_schedules` | Hours, schedules, time off, blocks, resources |
| `manage_bookings` | Booking, waitlist, inquiry, and quote operations |
| `view_customers` | Salon-wide CRM read |
| `manage_customers` | Salon-wide CRM mutations |
| `view_booking_payments` | Booking advance/payment visibility |
| `manage_notifications` | Notification templates and queue |
| `manage_integrations` | Connectors, jobs, webhook operations, outbox |
| `manage_settings` | Business settings and audit visibility |

Route middleware rejects obvious unauthorized requests; services reapply record ownership and branch scope to prevent IDOR. Hiding a frontend button is not authorization.

## HTTP contract

### Success, pagination, and deletion

Normal success:

```json
{
  "success": true,
  "data": {}
}
```

Created resources return `201`. Some actions return `204` with no response body.

Paginated collection:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 0,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

Collections generally default to page `1`, limit `20`, and cap limit at `100`. Consult the endpoint's validator for available filters and sort fields.

`DELETE` commonly means archive/deactivate/cancel, not physical deletion. Use the returned state and do not assume the record disappeared.

### Error envelope

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message",
    "details": {},
    "requestId": "..."
  }
}
```

`details` is optional. Development-only internal failures may include `debug`; production does not. Common status meanings:

- `400`: malformed input, rejected unknown fields, invalid ID/date/state.
- `401`: missing/invalid/expired authentication.
- `403`: role, permission, branch, ownership, or CSRF denial.
- `404`: route or scoped resource not found.
- `409`: duplicate, stale version, invalid state transition, occupied slot, or idempotency mismatch.
- `413`: request body exceeds `REQUEST_BODY_LIMIT`.
- `429`: rate limit.
- `503`: dependency/provider unavailable or production fail-closed rate limiter.

Every request receives `X-Request-Id`; a safe caller-supplied value is preserved. Send it in frontend error telemetry and support tickets.

### Validation and security

- JSON schemas are strict: unknown keys are rejected.
- Keys containing MongoDB operators/path syntax and prototype-pollution keys are rejected recursively.
- IDs are MongoDB ObjectId strings unless otherwise documented.
- Phones use E.164, such as `+94771234567`.
- Instants require ISO 8601 with `Z` or an explicit offset.
- Local dates use `YYYY-MM-DD`; wall-clock hours use `HH:mm`.
- Auth responses are `no-store`.
- Payment webhooks use raw bytes before JSON parsing and a separate rate limit.
- The allowed request headers include `Authorization`, `Content-Type`, `Idempotency-Key`, `X-CSRF-Token`, and `X-Request-Id`.
- `If-Match` is CORS-allowed for future compatibility but is not a documented API concurrency contract.

### Idempotency

Send an `Idempotency-Key` of 8–200 characters for:

- `POST /customer/bookings`
- `POST /staff/bookings`
- `POST /customer/quotes/:quoteId/accept`
- `POST /staff/quotes/:quoteId/schedule`
- `POST /customer/payments/advance-checkouts`
- `POST /staff/payments/advances`
- `POST /staff/payments/:paymentId/refunds`

A new booking returns `201`; an exact replay returns `200` with `meta.idempotentReplay: true`. Reusing a key for a different fingerprint returns `409`. Payment idempotency is provider/operation scoped and applies the same mismatch protection.

Integration job and mapping conflict operations use validated idempotency values in their request body. Endpoints not listed above are not guaranteed idempotent; do not blindly retry their mutations.

Generate one stable key for a user action and preserve it during network retries:

```ts
const key = crypto.randomUUID();

await fetch(`${API}/customer/bookings`, {
  method: "POST",
  credentials: "include",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Idempotency-Key": key,
  },
  body: JSON.stringify(bookingInput),
});
```

## API endpoint reference

All endpoints below use `/api/v1` except the top-level health/readiness probes. Exact bodies, filters, and defaults live in the linked validators.

Legend:

- `Public`: no authentication.
- `Auth`: any authenticated active user.
- `Customer`: authenticated customer, automatically self-scoped.
- `Employee self`: employee with active `StaffAccess`; no management permission required.
- `Staff + x`: admin or employee with active access and permission `x`.
- `Admin + x + all`: admin role, permission `x`, and all-branch access.
- `Scoped`: service applies the staff member's allowed branches.

### System and authentication

| Method | Path | Access/purpose |
|---|---|---|
| `GET` | `/health`, `/healthz` | Public liveness, uptime, timezone |
| `GET` | `/ready`, `/readyz` | Public dependency readiness; `503` if MongoDB/Redis is unavailable |
| `POST` | `/auth/register/customer` | Public customer local registration |
| `POST` | `/auth/login` | Public email/mobile identifier plus password |
| `POST` | `/auth/google` | Public Google ID-token customer login |
| `POST` | `/auth/refresh` | Cookie+CSRF or explicit refresh-token rotation |
| `POST` | `/auth/logout` | Auth; revoke current session |
| `POST` | `/auth/logout-all` | Auth; revoke every user session |
| `PATCH` | `/auth/password` | Auth; change/set password and rotate session |
| `GET` | `/auth/me` | Auth; current safe user |
| `POST` | `/auth/password/forgot` | Public generic reset request |
| `POST` | `/auth/password/reset` | Public one-time reset token |
| `POST` | `/auth/email-verification/request` | Auth; queue verification |
| `POST` | `/auth/email-verification/confirm` | Public one-time verification token |
| `GET` | `/auth/sessions` | Auth; list active sessions |
| `DELETE` | `/auth/sessions/:sessionId` | Auth; revoke one owned session |

### Public business, catalog, and availability

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/public/business` | Public salon overview/settings projection |
| `GET` | `/public/branches` | Active public branches |
| `GET` | `/public/branches/:branchId` | Public branch detail |
| `GET` | `/public/branches/:branchId/hours` | Effective branch hours |
| `GET` | `/public/catalog/categories` | Public categories |
| `GET` | `/public/catalog/categories/:categoryId` | Public category |
| `GET` | `/public/catalog/services` | Public services |
| `GET` | `/public/catalog/services/:serviceId` | Public service; optional `branchId` query resolves branch offering |
| `GET` | `/public/catalog/products` | Public product discovery |
| `GET` | `/public/catalog/products/:productId` | Public product |
| `GET` | `/public/catalog/packages` | Public package discovery |
| `GET` | `/public/catalog/packages/:packageId` | Public package |
| `GET` | `/public/availability` | Slots for `branchId`, `serviceId`, `date`; optional employee/customer gender |

Availability responses are rate-limited and `no-store`. They contain branch, service, local date, timezone, generation time, eligible employees, phase/resource assignments, resolved price, and slots. They are advisory: booking creation always revalidates the slot.

### Customer self-service

| Method | Path | Purpose |
|---|---|---|
| `GET`, `PATCH` | `/customers/me` | Own customer profile |
| `GET`, `POST` | `/customer/bookings` | Own booking list/create |
| `GET` | `/customer/bookings/:bookingId` | Own safe booking view |
| `POST` | `/customer/bookings/:bookingId/cancel` | Own booking cancellation |
| `POST` | `/customer/bookings/:bookingId/reschedule` | Own booking reschedule |
| `GET`, `POST` | `/customer/waitlist` | Own waitlist list/create |
| `GET` | `/customer/waitlist/:waitlistEntryId` | Own waitlist entry |
| `POST` | `/customer/waitlist/:waitlistEntryId/cancel` | Own waitlist cancellation |
| `GET`, `POST` | `/customer/inquiries` | Own inquiry list/create |
| `GET` | `/customer/inquiries/:inquiryId` | Own inquiry and visible quote state |
| `POST` | `/customer/inquiries/:inquiryId/cancel` | Own inquiry cancellation |
| `POST` | `/customer/quotes/:quoteId/accept` | Accept own sent quote; idempotency required |
| `POST` | `/customer/quotes/:quoteId/reject` | Reject own sent quote |
| `GET` | `/customer/payments` | Own booking advance/refund records |
| `POST` | `/customer/payments/advance-checkouts` | Create own advance checkout |
| `GET` | `/customer/payments/:paymentId` | Own payment record |

The authenticated customer's ID is authoritative. Customer-supplied `customerId` values are not trusted for self-service operations, and internal snapshots/notes are not exposed.

### Notification self-service

| Method | Path | Access/purpose |
|---|---|---|
| `GET`, `PUT` | `/notifications/preferences` | Auth; own channel/topic/locale/reminder preferences |
| `GET`, `POST` | `/notifications/push-subscriptions` | Auth; own device subscriptions |
| `DELETE` | `/notifications/push-subscriptions/:subscriptionId` | Auth; revoke owned device |

### Employee self-service

| Method | Path | Purpose |
|---|---|---|
| `GET`, `PATCH` | `/employees/me` | Own employee profile |
| `GET` | `/employees/me/bookings` | Assigned booking calendar only |
| `GET` | `/employees/me/bookings/:bookingId` | Assigned booking view only |
| `GET`, `POST` | `/employees/me/time-off` | Own time-off list/request |
| `POST` | `/employees/me/time-off/:timeOffId/cancel` | Cancel own eligible request |

These routes require an employee role and active staff access but deliberately do not require `manage_bookings` or `manage_schedules`.

### Customer and staff administration

| Method | Path | Required access |
|---|---|---|
| `GET` | `/customers` | Staff + `view_customers` |
| `POST` | `/customers` | Staff + `manage_customers` |
| `GET` | `/customers/:customerId` | Staff + `view_customers` |
| `PATCH`, `DELETE` | `/customers/:customerId` | Staff + `manage_customers` |
| `GET`, `POST` | `/employees` | Staff + `manage_staff` |
| `GET`, `PATCH`, `DELETE` | `/employees/:employeeId` | Staff + `manage_staff` |
| `POST` | `/employees/:employeeId/account` | Staff + `manage_staff`; provision local login |
| `GET`, `PUT` | `/employees/:employeeId/access` | Staff + `manage_staff` |
| `GET` | `/employees/:employeeId/skills` | Staff + `manage_staff` |
| `PUT`, `DELETE` | `/employees/:employeeId/skills/:skillId` | Staff + `manage_staff` |
| `GET` | `/employees/:employeeId/services` | Staff + `manage_staff` |
| `PUT`, `DELETE` | `/employees/:employeeId/services/:serviceId/branches/:branchId` | Staff + `manage_staff`, scoped branch |
| `GET`, `POST` | `/admins` | Admin + `manage_staff` |
| `GET`, `PATCH` | `/admins/:adminId` | Admin + `manage_staff` |
| `PUT` | `/admins/:adminId/access` | Admin + `manage_staff` |
| `GET`, `POST` | `/skills` | Staff + `manage_staff` |
| `PATCH`, `DELETE` | `/skills/:skillId` | Staff + `manage_staff` |
| `GET`, `POST` | `/employee-levels` | Staff + `manage_staff` |
| `PATCH`, `DELETE` | `/employee-levels/:levelId` | Staff + `manage_staff` |

Employee records can span branches. Read access is allowed when the staff
member can access at least one assigned branch, while global employee
mutations—profile/lifecycle changes, login provisioning, access policy, and
skills—require access to every branch assigned to that employee. Service
eligibility remains branch-specific.

### Business and branches

| Method | Path | Required access |
|---|---|---|
| `POST` | `/admin/business/bootstrap` | Admin + `manage_business` + all; one time |
| `GET` | `/admin/business/profile` | Staff + `manage_business` |
| `PUT` | `/admin/business/profile` | Staff + `manage_business` + all |
| `GET` | `/admin/business/settings` | Staff + `manage_settings` |
| `PUT` | `/admin/business/settings` | Staff + `manage_settings` + all |
| `GET` | `/admin/branches` | Staff + `manage_branches`, scoped |
| `POST` | `/admin/branches` | Staff + `manage_branches` + all |
| `GET` | `/admin/branches/:branchId` | Staff + `manage_branches`, scoped |
| `PATCH`, `DELETE` | `/admin/branches/:branchId` | Staff + `manage_branches` + all |
| `GET`, `POST` | `/admin/branches/:branchId/hours` | Staff + `manage_schedules`, scoped |
| `GET`, `PATCH`, `DELETE` | `/admin/branches/:branchId/hours/:hoursId` | Staff + `manage_schedules`, scoped |

Business profile/settings are singleton records. Branch and branch-hours changes use booking-configuration writer leases so they do not race an in-progress availability allocation.

### Catalog

| Method | Path | Required access |
|---|---|---|
| `GET`, `POST` | `/admin/catalog/categories` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `PATCH`, `DELETE` | `/admin/catalog/categories/:categoryId` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `POST` | `/admin/catalog/services` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `PATCH`, `DELETE` | `/admin/catalog/services/:serviceId` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `POST` | `/admin/catalog/products` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `PATCH`, `DELETE` | `/admin/catalog/products/:productId` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `POST` | `/admin/catalog/packages` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `PATCH`, `DELETE` | `/admin/catalog/packages/:packageId` | Staff + `manage_catalog`; mutation requires all |
| `GET`, `POST` | `/admin/catalog/branch-services` | Staff + `manage_catalog`; create is branch-scoped |
| `GET`, `PATCH`, `DELETE` | `/admin/catalog/branch-services/:branchServiceId` | Staff + `manage_catalog`, offering branch scoped |

Global catalog writes require all-branch access. A `BranchService` activates a global service at a branch and may override price, duration, or advance policy.

### Scheduling

| Method | Path | Required access |
|---|---|---|
| `GET`, `POST` | `/admin/scheduling/branches/:branchId/employees/:employeeId/schedules` | Staff + `manage_schedules`, scoped |
| `GET`, `PATCH`, `DELETE` | `/admin/scheduling/branches/:branchId/employees/:employeeId/schedules/:scheduleId` | Staff + `manage_schedules`, scoped |
| `GET` | `/admin/scheduling/time-off` | Staff + `manage_schedules`, results scoped |
| `POST` | `/admin/scheduling/time-off/:timeOffId/approve` | Staff + `manage_schedules`, scoped |
| `POST` | `/admin/scheduling/time-off/:timeOffId/reject` | Staff + `manage_schedules`, scoped |
| `POST` | `/admin/scheduling/time-off/:timeOffId/cancel` | Staff + `manage_schedules`, scoped |
| `GET`, `POST` | `/admin/scheduling/branches/:branchId/calendar-blocks` | Staff + `manage_schedules`, scoped |
| `GET`, `PATCH`, `DELETE` | `/admin/scheduling/branches/:branchId/calendar-blocks/:blockId` | Staff + `manage_schedules`, scoped |
| `GET`, `POST` | `/admin/scheduling/branches/:branchId/resources` | Staff + `manage_schedules`, scoped |
| `GET`, `PATCH`, `DELETE` | `/admin/scheduling/branches/:branchId/resources/:resourceId` | Staff + `manage_schedules`, scoped |

An employee schedule defines all seven weekdays, supports multiple shifts and contained breaks, has effective dates, and cannot overlap another active effective schedule for the same employee/branch. Time off, blocks, and resources participate in availability.

### Staff booking operations

Every route in this table requires staff role, active branch scope, and `manage_bookings`.

| Method | Path | Purpose |
|---|---|---|
| `GET`, `POST` | `/staff/bookings` | Scoped booking list/create |
| `POST` | `/staff/bookings/expire-holds` | Expire due pending-advance holds |
| `GET` | `/staff/bookings/:bookingId` | Scoped booking |
| `POST` | `/staff/bookings/:bookingId/cancel` | Cancel, optionally authorized policy override |
| `POST` | `/staff/bookings/:bookingId/reschedule` | Reallocate booking |
| `POST` | `/staff/bookings/:bookingId/transition` | Apply status state machine |
| `PUT` | `/staff/bookings/:bookingId/external-settlement` | Mirror external final settlement summary |
| `GET`, `POST` | `/staff/waitlist` | Scoped waitlist list/create |
| `POST` | `/staff/waitlist/expire-due` | Expire due offers |
| `GET` | `/staff/waitlist/:waitlistEntryId` | Scoped entry |
| `POST` | `/staff/waitlist/:waitlistEntryId/cancel` | Cancel entry |
| `POST` | `/staff/waitlist/:waitlistEntryId/offer` | Offer a time-limited opportunity |
| `GET` | `/staff/inquiries` | Scoped inquiry list |
| `GET` | `/staff/inquiries/:inquiryId` | Scoped inquiry |
| `POST` | `/staff/inquiries/:inquiryId/review` | Move inquiry into review |
| `POST` | `/staff/inquiries/:inquiryId/reject` | Reject inquiry |
| `POST` | `/staff/inquiries/:inquiryId/quotes` | Create versioned quote |
| `POST` | `/staff/quotes/expire-due` | Expire due quotes |
| `POST` | `/staff/quotes/:quoteId/send` | Send/activate draft quote |
| `POST` | `/staff/quotes/:quoteId/expire` | Explicitly expire quote |
| `POST` | `/staff/quotes/:quoteId/schedule` | Schedule an accepted quote |

### Booking advances and payment webhooks

| Method | Path | Required access |
|---|---|---|
| `GET` | `/staff/payments` | Staff + `view_booking_payments`, scoped |
| `GET` | `/staff/payments/:paymentId` | Staff + `view_booking_payments`, scoped |
| `POST` | `/staff/payments/advances` | Staff + `view_booking_payments` + `manage_bookings` |
| `POST` | `/staff/payments/:paymentId/refunds` | Staff + `view_booking_payments` + `manage_bookings` |
| `GET` | `/staff/payments/webhook-events` | Admin + `view_booking_payments` + `manage_integrations` + all |
| `POST` | `/staff/payments/webhook-events/:webhookEventId/retry` | Same as webhook-event list |
| `POST` | `/webhooks/payments/:provider` | Public transport endpoint; registered adapter signature required |

The webhook endpoint receives raw bytes, verifies the adapter's signature before accepting identifiers, stores only approved signature headers, encrypts the raw payload, deduplicates provider/merchant/event, and returns `202` for accepted asynchronous processing.

### Notification administration

Every route requires staff role and `manage_notifications`; template routes additionally require all-branch access.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/notifications/queue` | Inspect safe queue state |
| `POST` | `/admin/notifications/queue/:notificationId/retry` | Retry eligible item |
| `POST` | `/admin/notifications/queue/:notificationId/cancel` | Cancel eligible item |
| `GET`, `POST` | `/admin/notifications/templates` | List/create templates |
| `GET`, `PATCH`, `DELETE` | `/admin/notifications/templates/:templateId` | Read/update/deactivate template |

### External integrations

Every route requires staff role and `manage_integrations`.

| Method | Path | Purpose |
|---|---|---|
| `GET`, `POST` | `/admin/integrations/connectors` | List/create connector configuration |
| `GET`, `PATCH` | `/admin/integrations/connectors/:connectorId` | Read/update connector |
| `PUT` | `/admin/integrations/connectors/:connectorId/status` | Test/activate/deactivate connector |
| `GET`, `PUT` | `/admin/integrations/connectors/:connectorId/mappings` | List/upsert local-external IDs |
| `POST` | `/admin/integrations/connectors/:connectorId/mappings/:mappingId/resolve` | Resolve a mapping conflict |
| `GET`, `POST` | `/admin/integrations/connectors/:connectorId/sync-jobs` | List/enqueue explicit jobs |
| `POST` | `/admin/integrations/connectors/:connectorId/sync-jobs/:syncJobId/retry` | Retry eligible failed job |

### Operations

| Method | Path | Required access |
|---|---|---|
| `GET` | `/admin/audit-logs` | Admin + `manage_settings` + all |
| `GET` | `/admin/outbox` | Admin + `manage_integrations` + all |
| `POST` | `/admin/outbox/:outboxEventId/retry` | Admin + `manage_integrations` + all |

Audit output is a safe administrative projection and intentionally excludes sensitive changes, IP address, and user-agent data.

## Domain behavior

### Business timezone

The entire salon deployment uses one IANA timezone, defaulting to `Asia/Colombo`.

- Persisted `Date` values are UTC instants.
- API instants must include `Z` or an offset, for example `2026-07-26T09:30:00+05:30`.
- Branch hours and weekly shifts use local `HH:mm`.
- Schedule effective dates and other date-only values use `YYYY-MM-DD`.
- There are no per-branch timezone overrides.
- Never hardcode Sri Lanka's offset. Use the Temporal-based system timezone utilities because legal offsets and other deployment timezones can differ.

### Catalog: service, product, and package are different

| Type | Use | Calendar allocation |
|---|---|---|
| `Service` | Atomic salon work such as haircut, coloring, or keratin treatment | Yes |
| `Product` | Discoverable cream, shampoo, retail treatment, or tool | No |
| `ServicePackage` | Wedding, event, bundle, service/product presentation | Through inquiry/quote scheduling, not direct package expansion |

Categories are hierarchical and declare whether they apply to services, products, packages, or a combination.

A service defines:

- Client gender routing.
- Required employee skills.
- Application, processing, finishing, and buffer phases.
- Whether processing keeps the employee blocked.
- Base and employee-level pricing.
- Optional service advance policy.
- Booking mode: `instant`, `request`, or `consultation_required`.

`BranchService` enables it at a location and can override price, duration, and advance. `EmployeeService` makes an employee eligible for a service at a branch and can add employee-specific pricing/duration and online-bookability rules.

Products support `in_store`, `external_link`, and `inquiry` discovery modes. There is no cart, checkout, stock deduction, or product order API.

Packages support bundles, weddings/events, included products, party sizing, and off-site/travel policy. Their booking mode is `request_quote` or `consultation_required`; instant package booking is explicitly unsupported. Package usage is through inquiry, quote, acceptance, and staff scheduling. A direct `POST /bookings` accepts atomic service items and never expands a package. Public reads hide any legacy package still marked `instant`, and the first supported admin update/archive migrates that legacy value to `request_quote`.

### Pricing and advances

Money is always an integer number of minor units. Never send or store floating-point currency values.

Implemented price presentation modes:

- `fixed`
- `starting_from`
- `range`
- `quote_required`

Availability resolves price in this order:

1. Employee-service override.
2. Employee-level price tier.
3. Branch-service override.
4. Base service price.

Advance policy resolves in this order:

1. Branch-service override.
2. Service policy.
3. Business default.
4. An accepted quote may preserve its explicit accepted amounts.

Advance requirement can be `none`, `optional`, or `required`; calculation can be none, fixed, or percentage, with estimate/accepted-quote basis. A required advance creates a `pending_advance` booking with held reservations and an expiry. A confirmed successful advance atomically confirms the booking. An optional advance never blocks confirmation.

For `starting_from` or `range` pricing, direct booking requires `customerAcceptedVariablePricing: true`. `quote_required` services cannot be direct-booked.

The booking stores immutable customer, service, employee, pricing, advance, cancellation, event, and included-product snapshots. The final salon price may change after consultation/service. Final billing remains external.

### Employee eligibility and availability

Availability evaluates:

- Active branch and branch online-booking state.
- Active branch-service offering.
- Active/bookable employee and employee-service capability.
- Service target gender and employee working-gender configuration.
- Required active skills and unexpired certifications.
- Branch hours.
- Employee effective schedule and breaks.
- Approved time off.
- Branch/employee calendar blocks.
- Existing employee and resource reservations.
- Resource type/capacity and service compatibility.
- Booking notice, booking window, and slot alignment.
- Maximum concurrent clients and processing-phase overlap rules.
- Off-site travel buffers where supplied through booking/quote scheduling.

Bookable resources can represent chairs, rooms, or equipment with capacity. Travel buffers create exclusive reservations around off-site work and are checked/locked like other allocations.

### Booking lifecycle

Direct customer booking is for `instant` services. Request/consultation work belongs in the inquiry/quote flow.

A booking transaction writes:

- The booking aggregate and items.
- Employee phase and resource calendar reservations.
- Off-site travel reservations when applicable.
- Audit and outbox data.

Supported state transitions:

```text
requested       → confirmed | cancelled
pending_advance → confirmed | cancelled
confirmed       → checked_in | cancelled | no_show
checked_in      → in_progress | cancelled | no_show
in_progress     → completed | cancelled
completed, cancelled, no_show → terminal
```

Cancellation policies are enforced; authorized staff can explicitly request an override. Rescheduling keeps the booking's service/employee allocation shape and rechecks the replacement times. It is not an arbitrary quote editor.

The lifecycle worker expires pending-advance holds and releases their reservations. Staff expiry endpoints exist for controlled operational use as well.

`externalSettlement.status` is only `not_tracked`, `pending_external`, or `settled_external` with an external reference/summary. It is not an invoice or accounting ledger.

### Waitlist

Customers or authorized staff can request one or more services for a branch, time window, party size, and optional preferred employees. States are:

```text
waiting → offered → booked
              └──→ expired
waiting/offered → cancelled
```

An offer has a deadline and the lifecycle worker expires overdue offers. The waitlist does not automatically choose a slot or create a booking; the chosen slot is still validated during booking.

### Inquiries and quotes

Inquiry types cover service, product, package, wedding, and event requests, including preferred dates and optional off-site venue details. Staff can review/reject an inquiry and create versioned quotes with:

- Service, product, or custom lines.
- Validity window and terms.
- Optional proposed service/employee times.
- Off-site travel buffers.
- Price total and advance requirement.

Quote states are `draft`, `sent`, `accepted`, `rejected`, `expired`, and `superseded`.

Customer acceptance automatically creates a booking only when the proposal contains exactly one complete schedulable service unit with employee and times. Otherwise acceptance reports that staff scheduling is required, and staff uses `/staff/quotes/:quoteId/schedule` with explicit service allocations. Product quote lines become booking included-product snapshots; they do not perform a stock sale.

A quote does not reserve the calendar for its entire validity period. Scheduling always performs a fresh locked availability check.

### Booking advances and refunds

This payment context is limited to booking advances and their refunds.

- A customer can create a checkout only for an owned, eligible future booking.
- Required advances request the remaining required amount.
- Optional advances allow a positive amount up to the remaining amount.
- Only one active checkout is allowed for the guarded booking operation.
- Provider checkout data is encrypted at rest.
- Staff can record a manual advance or a provider transaction.
- Non-manual staff records are verified through the registered adapter before acceptance.
- Amount, currency, purpose, booking ownership, and refund maximum are enforced.
- Advance confirmation and required-booking confirmation are atomic and replay-safe.

A payment adapter's successful webhook processing should call the exported `applyVerifiedAdvanceSettlement` service operation. That operation applies a verified settlement idempotently and can confirm a pending booking.

There is no final-payment checkout in this API.

### Notifications

Implemented notification data and APIs include:

- Per-user channels, topics, marketing consent, locale, and reminder lead time.
- Encrypted push subscription tokens.
- Versioned/deactivatable templates.
- A retryable/cancellable delivery queue.
- Per-channel provider ports for email, SMS, WhatsApp, and push.
- Leased asynchronous delivery with retry handling.

No concrete delivery provider is included. An unconfigured channel is not claimed by the worker.

Booking/auth actions create outbox events, but this repository does not currently include a generic event consumer that converts every event into a notification, nor a reminder scheduler that automatically generates reminder queue items. A deployment must add that event-to-notification composition if automatic reminders are required. Do not tell the frontend that reminders are sent merely because preferences/templates exist.

### External ERP/POS/CRM integration

The booking system is fully usable without an external connector.

Connectors contain provider/type/scope, optional branch, public HTTPS base URL, sync policies, polling configuration, and a secret reference. URL validation rejects embedded credentials and unsafe URLs. Secrets remain in the deployment's secret store.

Mappings associate a local ObjectId with an external ID for supported entity types such as customer, service, product, package, employee, branch, booking, quote, payment, and calendar block. External IDs are intentionally kept out of core domain documents.

Sync jobs are explicit, idempotent, leased, retryable, and can be dead-lettered/degrade a repeatedly failing connector. The worker invokes the provider adapter for the requested direction and operation.

No concrete ERP adapter, inbound ERP webhook, or automatic polling scheduler is included. `pollingIntervalMinutes` is connector configuration; this worker processes jobs that have already been enqueued through the API or deployment code. The external ERP/POS remains the owner of items/stock/accounting/final billing.

### Audit and outbox

Privileged domain mutations record append-only audit events with safe identifiers and field/status metadata rather than secrets or full request bodies.

Transactional outbox records separate committed domain changes from external publication. The outbox worker publishes only when an event publisher is registered; otherwise it stays idle and preserves queued events. Authorized administrators can inspect safe outbox state and retry eligible failures.

## Provider ports and deployment composition

The core exposes interfaces and in-memory registries:

| Port | Registration function | Responsibility |
|---|---|---|
| [Payment provider](src/ports/payment-provider.ts) | `registerPaymentProvider` | Checkout, transaction verification, signed webhook verification/processing |
| [Notification provider](src/ports/notification-provider.ts) | `registerNotificationProvider` | Delivery for one channel |
| [Integration provider](src/ports/integration-provider.ts) | `registerIntegrationAdapter` | Connection test and sync job execution |
| [Event publisher](src/ports/event-publisher.ts) | `registerEventPublisher` | Publish committed outbox events |

[src/providers/index.ts](src/providers/index.ts) is the composition root imported by both API and worker entry points. It intentionally registers no fake adapters.

A production deployment should:

1. Implement each required port in a provider module.
2. Read provider credentials from environment/secret manager.
3. Register exactly one adapter per provider/channel and at most one event publisher in `src/providers/index.ts`.
4. Import no web framework state into adapters.
5. Make all provider calls timeout-bounded and idempotent.
6. Test invalid signatures, duplicate events, retry behavior, and unavailable-provider behavior.

Without a concrete adapter:

- Payment operations for that provider return a configuration/unavailable error.
- Notification queue items for that channel remain unclaimed.
- Connector activation/job execution cannot use that provider.
- Outbox events remain queued when there is no publisher.

## Concurrency and data consistency

### MongoDB transactions

Booking creation/rescheduling, required-advance confirmation, configuration bootstrap, and other multi-document invariants use transaction helpers with primary reads, snapshot read concern, and majority write concern.

Run production against a replica set/sharded cluster and make transaction retry behavior part of deployment testing. Do not disable this startup requirement to use standalone production MongoDB.

### Redis locks and leases

Distributed locking is correctness infrastructure, not only an optimization:

- Locks have unique ownership tokens.
- Long operations renew leases.
- Release checks ownership.
- Lost-lock operations fail rather than committing an unsafe allocation.
- Multi-resource lock acquisition uses deterministic keys.
- Booking-configuration writers wait for readers, while booking allocation holds a read lease.

Redis should use persistence/high availability suitable for session and lock correctness. Monitor latency, evictions, memory, reconnects, and clock behavior. Do not configure arbitrary eviction of active session/lock keys.

### Optimistic concurrency and indexes

Mutable configuration/schedule models use versioning where appropriate, and stale updates can return `409 VERSION_CONFLICT`. Unique/partial indexes enforce singleton, identity, overlap, reference, and idempotency invariants.

Production disables automatic model index creation. Run the index command during a controlled deployment/migration step.

## Frontend integration guide

### Recommended startup sequence

1. Call `/public/business`.
2. If `branchMode` is `single`, use the primary branch and hide branch UI.
3. Otherwise load `/public/branches` and preserve the selected branch.
4. Load branch-filtered services and effective branch hours.
5. Query `/public/availability` only after branch, service, and local date are known.
6. Present the server's price mode and advance requirement exactly.
7. Generate one idempotency key when the user confirms booking/payment.
8. Treat availability conflicts as an expected `409`: reload slots and let the user choose again.

### Direct booking example

```json
{
  "branchId": "507f1f77bcf86cd799439011",
  "items": [
    {
      "serviceId": "507f1f77bcf86cd799439012",
      "employeeId": "507f1f77bcf86cd799439013",
      "startAt": "2026-08-01T10:00:00+05:30"
    }
  ],
  "customerAcceptedVariablePricing": true,
  "customerNote": "Please avoid strongly scented products."
}
```

Use the exact `startAt`, employee, and service returned by availability. Never calculate phase end times, resource IDs, price, or advance amount on the client.

### Frontend state rules

- Keep access token, CSRF token, and current user in an in-memory auth store.
- On a single `401`, perform one coordinated refresh and retry once.
- If refresh fails or replay protection revokes the family, clear local auth state and return to login.
- Use response `error.code`, not parsed English messages, for control flow.
- Display `error.message` and retain `requestId` for diagnostics.
- Drive staff navigation from current role and permissions, but still expect `403`.
- Reset branch-specific caches when the active branch changes.
- Use UTC/offset instants for API traffic and the business timezone for display.
- Do not send date-only text where an instant is required.
- Preserve integer minor units throughout formatting and forms.
- Show `starting_from` as “from/3000+” semantics and `range` as a range; never present them as a guaranteed final bill.
- Clearly distinguish optional versus required advances.
- Do not expose staff internal notes or assume customer booking payloads accept them.
- Do not retry non-idempotent mutations automatically.
- Do not assume `DELETE` physically removes a record.

### Common integration pitfalls

- Calling `/customer/...` for the customer profile. The profile route is plural: `/customers/me`; booking/payment routes use singular `/customer`.
- Calling management calendar routes for an employee's own calendar. Use `/employees/me/bookings`.
- Forgetting `credentials: "include"` on browser auth calls.
- Reading an old CSRF token after refresh rotation.
- Running parallel refresh calls across tabs.
- Sending Google OAuth authorization codes instead of a Google ID token.
- Treating a public availability response as a reservation.
- Direct-booking `quote_required`, request, or consultation services.
- Assuming accepting every quote immediately creates a booking.
- Assuming a package ID can be posted directly as a booking item.
- Treating an optional advance as a booking gate.
- Treating external settlement status as payment evidence or an invoice.
- Assuming a connector setting schedules polling automatically.
- Assuming notification preferences/templates mean reminders are already generated and delivered.

## Production deployment

### Build and initial deployment

```bash
npm ci
npm run check
npm run build
npm run db:indexes
npm run bootstrap:admin:prod
npm start
```

Run first-admin bootstrap only once and remove its password immediately. Then authenticate and run the protected business bootstrap once. On later releases, do not rerun either bootstrap command.

Run at least:

- One API process.
- One `worker:operations:prod` process, or separately scaled worker-kind processes.
- A production replica-set/sharded MongoDB.
- A durable/high-availability Redis.
- A TLS-terminating reverse proxy/load balancer.

API instances and worker instances are stateless apart from MongoDB/Redis and can be horizontally scaled. Provider adapter registration and secrets must be identical for every process that handles that provider's work.

### Deployment checklist

- [ ] `NODE_ENV=production`.
- [ ] MongoDB is a replica set or sharded cluster and transaction behavior is tested.
- [ ] Redis is private, authenticated/TLS-protected where supported, durable, monitored, and has a safe eviction policy.
- [ ] Three independent random auth secrets are installed and rotation/recovery is documented.
- [ ] `DATA_ENCRYPTION_KEY` is backed up securely before encrypted features are enabled; losing it makes protected payloads unreadable.
- [ ] HTTPS is enforced and `AUTH_COOKIE_SECURE=true`.
- [ ] `AUTH_COOKIE_SAME_SITE` matches the frontend topology.
- [ ] `CORS_ORIGIN` contains only explicit trusted origins.
- [ ] `TRUST_PROXY` matches the exact proxy topology.
- [ ] Request/body/rate limits are sized for the deployment and `429`/`503` are monitored.
- [ ] First admin and business bootstrap have completed; bootstrap password has been removed.
- [ ] Production indexes have been applied in a controlled step.
- [ ] Required provider adapters are registered and credentials come from a secret manager.
- [ ] Payment webhook routes receive the original raw body and provider signature headers through the proxy unchanged.
- [ ] API liveness probes use `/healthz`; readiness probes use `/readyz`.
- [ ] API and worker receive `SIGTERM` and have at least `SHUTDOWN_TIMEOUT_MS` to drain.
- [ ] Logs are collected as structured output and correlated by `X-Request-Id`.
- [ ] MongoDB, Redis, worker lease age, dead-letter/retry counts, webhook failures, and outbox backlog are alerted.
- [ ] Database backups and restore tests include encryption-key recovery.
- [ ] Frontend has refresh serialization, idempotency keys, branch reset behavior, and error-code handling.
- [ ] Adapter sandbox tests cover duplicate payment events and invalid webhook signatures before live credentials are enabled.

## Verification and maintenance

Before handing a change to another team:

```bash
npm run check
```

When adding or changing an endpoint:

1. Update its strict Zod schema.
2. Keep the controller thin.
3. Enforce ownership/permission/branch scope in the service, not only middleware.
4. Decide whether the mutation needs a booking-configuration writer lease, allocation locks, transaction, audit, outbox event, or idempotency.
5. Add tests for success, validation, forbidden scope, concurrency/conflict, and replay where relevant.
6. Update this endpoint/behavior contract.

There is currently no generated OpenAPI document. Frontend teams should use route files plus validators for field-level contracts and should not infer undocumented fields from database models.

## Explicitly not implemented

To prevent planning mistakes, the following are outside the current implementation:

- Multi-tenant/shared-database salons.
- POS sales and final checkout.
- Product cart/order/fulfilment.
- Inventory/stock/purchasing.
- Accounting, tax, invoices, and ledger.
- Payroll and commission.
- Final service bill/payment collection.
- Phone OTP authentication.
- Google authorization-code flow; the endpoint accepts an ID token.
- Concrete payment-gateway adapters.
- Concrete email/SMS/WhatsApp/push providers.
- Concrete ERP/POS/CRM/calendar adapters.
- A configured message-bus/event publisher.
- Automatic ERP polling job creation.
- Automatic reminder/event-to-notification generation.
- Inbound ERP webhooks.
- Direct package-to-booking expansion.
- A generated OpenAPI specification.
- A frontend.

These boundaries are intentional extension points, not permission to use mock providers in production.
