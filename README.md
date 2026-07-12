# Salon Booking Backend

Booking and scheduling backend for one salon business that can operate one or many branches. It is built with Node.js, Express, TypeScript, MongoDB/Mongoose, Redis, JWT authentication, and optional asynchronous ERP/POS integration.

The backend owns customer discovery, the public catalog, staff capability, schedules, availability, bookings, optional booking advances, reminders, and integration synchronization. It does not own POS checkout, inventory, accounting, payroll, or the final salon bill.

## Current Implementation Status

Implemented in this repository:

- Async Express application startup and graceful shutdown.
- MongoDB and Redis connection management.
- Health and readiness endpoints.
- Validated environment configuration and one system timezone.
- Mongoose 9-compatible authentication and domain models.
- Single-salon, multi-branch model structure.
- Customer, employee, permission, service capability, and schedule models.
- Separate service, product, and package catalog models.
- Fixed, starting-from, range, and quote-required pricing.
- Optional or required booking-advance policies.
- Wedding/event inquiry and versioned quote models.
- Booking, calendar reservation, waitlist, payment, notification, audit, and ERP sync models.
- Domain-based model folders and typed barrel exports.

Still to be implemented by the backend team:

- Request validation, repositories, controllers, routes, and API DTOs.
- Auth endpoints and JWT issuance/refresh/revocation services.
- Availability calculation and booking transaction services.
- Advance payment provider/webhook integration.
- Notification provider workers.
- ERP API adapters and sync workers.
- Initial business/branch setup command or endpoint.

The data model is ready for those layers, but model existence must not be confused with completed API behavior.

## Core Business Invariant

One deployment and one MongoDB database represent exactly one salon business.

```text
One deployment / database
└── One BusinessProfile
    ├── One BusinessSettings
    └── One or more Branch records
```

There is no `salonId` tenant field on every document. A second unrelated salon should use a separate deployment/database configuration. This prevents tenant data leakage and keeps queries and indexes simpler.

A salon that has no branch concept still creates one internal primary `Branch`. Set `BusinessSettings.branchMode` to `single`, set `primaryBranchId`, and hide branch selection in the frontend. A salon with several branches sets the mode to `multiple` and exposes branch selection.

All appointments and calendar operations require a `branchId`. This avoids nullable scheduling records and allows the same booking logic to work for both single-location and multi-branch salons.

## System Timezone

The whole deployment uses one IANA timezone:

```env
TZ=Asia/Colombo
```

`Asia/Colombo` is the default. `src/config/env.ts` validates the value, applies it to the Node process, and exports it as `config.TIME_ZONE`. The health endpoint and startup log also report the active timezone.

Time rules:

- MongoDB `Date` values are absolute instants and remain UTC internally.
- API timestamps must include `Z` or an explicit offset, for example `2026-07-12T09:30:00+05:30`.
- Branch hours and weekly shifts store local wall-clock values as `HH:mm`.
- Birth dates, employment dates, schedule effective dates, and inquiry preferred dates use `YYYY-MM-DD` strings.
- There are no per-branch or per-user timezone overrides.
- Use `src/utils/dateTime.ts` for system-zone display formatting.
- Availability services must convert local date plus `HH:mm` through a timezone-aware library before storing/querying UTC instants. Do not hardcode `+05:30`.

## Architecture

The intended request flow is:

```text
Route -> validation -> controller -> service -> repository/model
                                      |
                                      +-> Redis lock
                                      +-> MongoDB transaction
                                      +-> Outbox event
```

- Routes define HTTP paths and middleware.
- Validation rejects invalid input before business logic.
- Controllers translate HTTP requests/responses and remain thin.
- Services own permissions, pricing resolution, availability, transitions, and transactions.
- Repositories/models own database access.
- Workers process notifications, payment webhooks, outbox events, and ERP sync jobs.

Do not calculate availability, authorize roles, or resolve prices in controllers or the frontend.

## Model Folder Structure

```text
src/models/
├── access/          # StaffAccess and branch permissions
├── audit/           # Append-only audit records
├── auth/            # User credentials and auth rules
├── bookings/        # Booking, items, inquiries, quotes, waitlist
├── business/        # BusinessProfile, BusinessSettings, Branch
├── catalog/         # Categories, services, products, packages
├── core/            # Shared schemas, validation, pricing types
├── customers/       # Customer profile
├── events/          # Transactional outbox
├── integrations/    # Optional ERP/POS/CRM/calendar synchronization
├── notifications/   # Preferences, templates, queue, push tokens
├── payments/        # Booking advances and provider webhooks
├── scheduling/      # Hours, shifts, blocks, resources, reservations
├── staff/           # Employees, levels, skills, service capability
└── index.ts          # Public model/type exports
```

Import from the root barrel when consuming models from another application layer:

```ts
import {
  Booking,
  Branch,
  BusinessSettings,
  Customer,
  Employee,
  Product,
  Service,
  ServicePackage,
} from "./models/index.js";
```

Each domain also has its own `index.ts` for narrower imports.

## Authentication and Authorization

`User` is the login identity and the canonical account role. Roles are:

- `customer`
- `employee`
- `admin`

Authentication rules:

- Customers may use email/password, mobile/password, Google, or both local and Google auth.
- Employees and admins must use local email/mobile plus password.
- Google requires a verified Google subject and email.
- Passwords are bcrypt-hashed with cost 12 and limited to 72 UTF-8 bytes.
- Credential fields, lock state, and token version are hidden by default.
- Protected credential changes through query updates, replacements, `insertMany`, and `bulkWrite` are blocked so hashing/validation cannot be bypassed.

Auth queries that need credential state must explicitly select:

```ts
USER_AUTH_SELECT = "+password +failedLoginAttempts +lockedUntil +tokenVersion";
```

Related records:

- `Customer` stores the salon customer profile and may optionally link to a `User`. Walk-ins and ERP-imported customers can exist without a login.
- `Employee` stores the staff profile and must link to a local-login `User` before becoming active.
- `StaffAccess` stores permissions, active/revoked state, and all-branch or selected-branch access. It does not duplicate the role; `User.role` remains authoritative.

Every privileged request service must verify the JWT, active `User`, matching role, active `StaffAccess`, required permission, and allowed branch.

## Business and Branch Models

### `BusinessProfile`

The singleton salon identity: name, legal name, slug, contacts, logo, registered address, and active state. `singletonKey: "default"` is uniquely indexed so only one profile exists.

### `BusinessSettings`

The singleton operational configuration:

- Single or multiple branch mode.
- Primary branch.
- Locale and currency (`en-LK` and `LKR` defaults).
- Whether final payment is handled at the salon or in an external system.
- Booking notice, booking window, slot interval, hold duration, waitlist, and overlap rules.
- Customer authentication options.
- Default advance policy.
- Reminder timings and channels.

### `Branch`

A physical operating location. It contains code, contact details, address, primary status, active status, and whether bookings are enabled. Only one branch can have `isPrimary: true`.

## Catalog

Products, services, and packages are separate because their rules are different.

| Model | Purpose | Creates calendar time? | Payment/stock owner |
|---|---|---:|---|
| `Service` | Haircut, keratin treatment, coloring, styling | Yes | Final bill is external/at salon |
| `Product` | Cream, shampoo, retail keratin product, tools | No | ERP/POS or salon counter |
| `ServicePackage` | Wedding, bridal party, event, service bundle | Its service components do | Final bill is external/at salon |

This backend can display products and synchronize them with an ERP, but it does not implement stock, cart, product checkout, tax, or sales accounting. If online product ordering is required later, add a separate Order bounded context instead of putting retail sales into Booking.

### `CatalogCategory`

Shared hierarchical categories for services, products, and packages. `appliesTo` controls which catalog types may use a category.

### `Service`

An atomic schedulable service with:

- Category, code, name, slug, and description.
- Client gender routing.
- Required skills.
- Application, processing, finishing, and buffer minutes.
- Whether processing blocks the employee.
- Price presentation and employee-level prices.
- Optional service-specific advance policy.
- Instant, request, or consultation-required booking mode.

### `BranchService`

Enables a service at a branch and optionally overrides its price, duration, and advance policy. A service stays business-wide; this model contains branch-specific availability.

### `Product`

A locally complete retail catalog record with optional SKU/barcode/brand, images, display price, selected/all-branch visibility, and purchase mode:

- `in_store`
- `external_link`
- `inquiry`

`inquiry` products can be referenced by `BookingInquiry` without creating calendar time.

There are deliberately no quantity-on-hand, cost, purchase-order, or sales-ledger fields.

### `ServicePackage`

A reusable bundle, wedding package, or event package. It contains service components, optional product inclusions, party-size limits, off-site and travel rules, price presentation, advance policy, and booking mode.

Instant packages expand into individual scheduled `BookingItem` records. Wedding and variable event packages normally use inquiry and quote flow.

## Pricing

All money uses integer minor units. For LKR, follow the payment provider's minor-unit convention consistently across the system. Never store floating-point money.

`PricePresentation` supports:

- `fixed`: one exact catalog amount.
- `starting_from`: display a minimum such as `LKR 3,000+`; it is not a final total.
- `range`: display a minimum and maximum.
- `quote_required`: no amount is promised until the salon creates a quote.

Catalog prices are marketing and scheduling inputs. Booking snapshots preserve what the customer saw or accepted:

- Displayed exact amount for fixed pricing.
- Displayed starting amount.
- Both displayed bounds for range pricing.
- Estimated subtotal, when available.
- Accepted quoted subtotal, when available.
- Customer acknowledgement of variable pricing.

The external system or salon counter may change/finalize the price after consultation or service completion. Do not overwrite the original booking snapshot. Update only the booking's `externalSettlement` operational summary if final status/amount is synchronized.

## Advance Payments

`AdvancePolicy` separates requirement from calculation:

- Requirement: `none`, `optional`, or `required`.
- Calculation: `none`, `fixed`, or `percentage`.
- Percentage basis: estimate or accepted quote.

Important behavior:

- An optional advance never blocks booking confirmation.
- A required advance can place a booking in `pending_advance` until payment succeeds.
- Optional and required fixed/percentage advances must resolve to a positive value.
- Quote-required and highly variable services should calculate a percentage only from an explicit estimate/accepted quote, not from the public “starting from” value.
- A fixed optional/required advance is often clearer for weddings.

`BookingPayment` records only booking-related gateway activity:

- Advance.
- Advance refund.
- Cancellation/no-show fee only if this platform actually captures it.

It does not record the final POS transaction. `PaymentWebhookEvent` stores an encrypted provider payload for idempotent, retryable processing.

## Staff and Service Capability

- `Employee`: profile, status, assigned branches, primary branch, bookability, online booking flag, served client gender, concurrency, and employment dates.
- `EmployeeLevel`: junior/senior/master-style ranking used by catalog tier pricing.
- `Skill`: salon-defined skill or certification.
- `EmployeeSkill`: proficiency and certification validity.
- `EmployeeService`: which employee may perform which service at which branch, with optional price, duration, and gender overrides.

An employee is eligible for a slot only when all of these are true:

```text
active employee
+ assigned branch
+ active branch service
+ active employee service capability
+ required skills
+ compatible client-gender routing
+ on shift
- time off
- calendar blocks
- conflicting reservations
= eligible and available
```

## Scheduling and Availability

- `BranchHours`: versioned weekly opening hours.
- `EmployeeSchedule`: versioned weekly shifts and breaks per branch.
- `TimeOff`: requested/approved staff leave scoped to all branches or selected branches.
- `CalendarBlock`: closures, meetings, training, maintenance, travel, and manual blocks.
- `BookableResource`: chairs, rooms, and equipment.
- `CalendarReservation`: held or confirmed employee/branch/resource time.

Availability is calculated as:

```text
branch opening hours
intersect employee shifts
minus breaks and approved time off
minus calendar blocks
minus active reservations
filtered by service/skill/gender/resource rules
= available slots
```

Temporary reservations have `holdExpiresAt` and a TTL index. Every availability query must still ignore expired holds immediately because MongoDB TTL cleanup is asynchronous.

Active `BranchHours` and `EmployeeSchedule` effective ranges must not overlap for the same scope. Enforce this transactionally in schedule activation services; Mongoose references cannot enforce cross-document range rules.

## Booking Workflows

### Fixed or variable service with no required advance

1. Frontend requests available slots.
2. Backend resolves branch/service/employee capability and price presentation.
3. Customer selects a slot and acknowledges variable pricing when applicable.
4. Booking service acquires Redis locks for every employee/resource.
5. Backend re-checks availability while holding the locks.
6. A MongoDB transaction creates `Booking`, `BookingItem`, `CalendarReservation`, and `OutboxEvent` records.
7. Booking becomes `confirmed`.
8. An optional advance may be paid, but it does not gate confirmation.

### Required advance

1. The same lock and availability checks run.
2. Backend creates a short-lived `pending_advance` booking and held reservations.
3. The payment provider webhook is verified and deduplicated.
4. Success atomically updates advance totals, confirms the booking/reservations, and queues notifications.
5. Failure or expiry cancels/expires the pending booking and releases the holds.

### Wedding, event, or quote-required package

```text
BookingInquiry
  -> BookingQuote revision(s)
  -> customer accepts one valid quote
  -> reacquire all employee/resource locks
  -> create Booking + BookingItems + CalendarReservations
  -> collect required advance if configured
  -> confirm
```

`BookingInquiry` stores preferred dates, party size, venue, requested services/products/package, and notes without pretending an exact slot exists. Product-only inquiries do not require an appointment date.

`BookingQuote` stores typed service, product, and custom line snapshots plus a revision number, validity, proposed schedule, quoted total, advance due, and terms. Only one revision per inquiry can be accepted.

Do not hold employee calendars for the entire quote lifetime. Lock resources only during quote acceptance/payment confirmation.

### Booking completion and final payment

The booking can reach `completed` even though the final bill is handled by the salon counter or ERP/POS. `Booking.externalSettlement` is only an operational mirror:

- `not_tracked`
- `pending_external`
- `settled_external`

It may hold an external reference, externally reported final amount, and sync timestamps. It is not an invoice or accounting ledger.

## Booking Data

### `Booking`

Header containing branch/customer references, source, status, exact UTC range, customer snapshot, complete fixed/from/range/quote pricing snapshot, advance summary, external settlement marker, package and included-product snapshots, cancellation snapshot, event details, and optional quote/package references.

### `BookingItem`

One scheduled service/provider assignment. It snapshots service name, employee identity, price truth, and every blocking/non-blocking phase so historical bookings do not change when catalog records change.

Products do not create `BookingItem` records.

### `WaitlistEntry`

Stores customer service requests for a branch and UTC time window. Matching must consider duration fit, capability, and resource availability, not only first-in-first-out order.

## Notifications and Reliable Side Effects

- `NotificationPreference`: channels, topics, reminder lead times, locale, and marketing consent.
- `NotificationTemplate`: channel/locale templates.
- `Notification`: idempotent retryable delivery queue.
- `PushSubscription`: encrypted push tokens and device state.
- `OutboxEvent`: events written in the same transaction as business changes.

Workers should claim outbox/notification jobs using leases, process them idempotently, and retry with backoff. Marketing must remain disabled after consent withdrawal.

## Optional ERP/POS Integration

The booking backend works with no connector. Local MongoDB records always have local ObjectIds and remain sufficient for catalog, customers, employees, and bookings.

When an ERP is configured:

- `ExternalConnector` stores provider configuration, business/branch scope, and per-entity sync policies.
- `ExternalEntityMapping` maps a local ObjectId to an external primary key.
- `IntegrationSyncJob` queues inbound/outbound create, update, delete, and reconciliation work.
- `OutboxEvent` triggers asynchronous synchronization after local transactions commit.

Supported mapping types include customer, service, product, package, employee, branch, booking, quote, booking payment, and calendar block.

Do not put ERP IDs directly on Customer, Service, or Product. A mapping table allows multiple connectors and keeps the system usable without ERP software.

Recommended ownership:

- Booking availability and calendar: local system is authoritative.
- Final bill, item sale, inventory, and accounting: ERP/POS is authoritative.
- Customers/catalog: configure `local`, `external`, or conflict policy per connector.
- ERP-created customers/services/products are imported into full local records plus mappings.
- Local changes enqueue sync jobs; booking confirmation must never wait for a live ERP call.

Connector URLs must be public HTTPS URLs, and credentials are referenced through `secretReference` rather than stored as plain text.

## Frontend Contract Guidance

Frontend developers should expect the future API to return:

- Current account role and allowed permissions/branches after login.
- `branchMode` and primary branch so branch selection can be hidden in single mode.
- Money as integer minor units plus currency.
- A price mode/label; never display `starting_from` as an exact total.
- Advance requirement separately from price.
- Booking status only after backend confirmation.
- UTC/offset timestamps for instants and `YYYY-MM-DD` for calendar dates.

Frontend must not:

- Trust a previously displayed slot as still available.
- Calculate the authoritative final price or advance.
- Change `pending_advance` to `confirmed` locally.
- Treat a product as a scheduled service.
- Expose internal notes, credential fields, hashes, encrypted payloads, or connector secrets.

## Initial Setup Order

The setup service/command should create records in this order:

1. `BusinessProfile` with `singletonKey: "default"`.
2. One primary `Branch`.
3. `BusinessSettings` with the branch mode and `primaryBranchId`.
4. Initial admin `User` using local authentication.
5. Active `StaffAccess` with all branches and required permissions.
6. Branch hours, categories, services/products/packages, employees, capabilities, and schedules.
7. Optional external connector and entity mappings.

The service must reject a second singleton profile/settings document and must keep exactly one active primary branch.

## Service-Layer Invariants Still Required

Mongoose validates document shape; services must enforce relationships and concurrency:

- Referenced branch/customer/employee/service records exist and are active.
- `User.role` is compatible with Customer/Employee/StaffAccess records.
- Staff routes require local-authenticated tokens and active permissions.
- An active employee has a local-login employee user and active staff access.
- Branch hours/schedule effective ranges do not overlap.
- Service/package category types are compatible.
- Package components and branch services are active.
- Price and advance resolution follows the override order.
- Booking and payment status transitions are valid.
- Advance refunds do not exceed successful original advances.
- All booking resources are locked and written transactionally.
- Incoming payment/integration webhooks are signed and idempotent.
- External settlement updates come only from trusted staff/integration paths.
- Audit logs and historical snapshots are never rewritten.

Suggested price override order:

```text
EmployeeService override
-> employee-level Service price
-> BranchService override
-> base Service price
```

The service should snapshot the resolved result before creating the booking.

## Environment Variables

```env
NODE_ENV=development
TZ=Asia/Colombo
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/salon_db
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=replace_with_a_long_random_secret
CORS_ORIGIN=http://localhost:3000
TRUST_PROXY=false
REQUEST_BODY_LIMIT=100kb
SHUTDOWN_TIMEOUT_MS=10000
```

Never commit the real `.env` file.

## Development

Install dependencies:

```bash
npm install
```

Run development mode:

```bash
npm run dev
```

Type-check without generating `dist`:

```bash
npx tsc --noEmit
```

Build and start:

```bash
npm run build
npm start
```

`npm run build` removes the generated `dist` directory first so JavaScript from old model paths cannot survive a folder refactor.

Lint:

```bash
npm run lint
```

The `dist` folder is generated output and must not be edited manually.

## Migration Note

This refactor changed the previous multi-salon model into one-salon-per-database and renamed salon locations to branches. If production data already exists, do not deploy the new indexes blindly.

Before migration:

- Confirm the database contains records for only one salon.
- Backfill every operational record with a valid branch reference.
- Rename `locationId` fields to `branchId` and remove `salonId` only after verification.
- Reconcile duplicate codes/slugs/idempotency keys exposed by removing tenant prefixes.
- Migrate or intentionally rename old collections/model names.
- Drop obsolete indexes through a controlled migration; `autoIndex` does not remove them.
- Invalidate JWTs and drain old jobs/locks containing salon/location identifiers.
- Preserve existing UTC booking instants and historical price snapshots.

For a fresh database, create the new records directly using the initial setup order above.
