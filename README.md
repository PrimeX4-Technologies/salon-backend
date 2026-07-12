# Salon Backend

Booking-focused backend for salons, built with Node.js, Express, TypeScript, MongoDB/Mongoose, Redis, and stateless JWT authentication.

This project is designed to manage online bookings, customers, salon staff, schedules, service capability, booking deposits/advance payments, notifications, and optional external ERP/POS synchronization. It intentionally does not implement POS checkout, stock/inventory, accounting, payroll, or ERP business logic.

## Current Status

The previous implementation work focused on the core application bootstrapping and the full booking-domain data model layer.

Implemented:

- Async app startup foundation with `src/index.ts`, `src/app.ts`, database/Redis configuration, and Redis service support.
- Mongoose 9 compatible model layer under `src/models`.
- Fixed the `User.ts` middleware error caused by callback-style Mongoose hooks.
- Reworked `User`, `Customer`, and `Employee` models for the salon domain.
- Added multi-salon, booking, scheduling, payment, notification, audit, and external sync models.
- Added model exports from `src/models/index.ts`.
- Verified TypeScript compilation with `npx tsc --noEmit`.

Not implemented yet:

- Auth controllers/routes.
- Booking controllers/routes/services.
- Admin/customer/employee API endpoints.
- Payment provider integration code.
- Notification provider integration code.
- ERP API client implementation.
- Frontend application.

## Architecture Summary

The intended architecture is layered:

```text
Routes -> Controllers -> Services -> Models/Data Access
```

Controllers should stay thin. They should parse the request, call a service, and return a response. Business rules belong in services, especially booking availability, payment state changes, permission checks, and integration sync behavior.

Authentication is intended to be stateless:

```http
Authorization: Bearer <jwt>
```

The backend should not depend on browser cookies for authentication. This keeps the API usable by web, mobile apps, and third-party integrations.

## Important Mental Model

There are two different identity concepts:

- `User` is the global login account.
- `Customer`, `Employee`, and `SalonMembership` are salon-specific business records.

For example, a customer login account is stored in `User`, while that customer's salon profile, preferences, source, and notes are stored in `Customer`.

An employee login account is also stored in `User`, but their salon-specific role, schedule, bookability, service permissions, and work locations are handled through `Employee`, `SalonMembership`, `EmployeeSchedule`, and `EmployeeService`.

## Auth Rules

`User.ts` now supports three roles:

- `admin`
- `employee`
- `customer`

Supported auth methods:

- `local`
- `google`

Rules:

- Customers can sign in with Google.
- Customers can also sign in with email/mobile and password.
- Admins must use local login only.
- Employees must use local login only.
- Google login requires a verified Google subject and email.
- Admins/employees cannot use Google login.
- A user must have either an email or an E.164 mobile number.
- Passwords are hashed with bcrypt.
- Password fields are hidden by default and must be explicitly selected only inside auth services.
- Direct query updates to protected auth fields are blocked. Load the user document, mutate it, and call `save()` so validation and hashing always run.

Useful auth select constant:

```ts
USER_AUTH_SELECT = "+password +failedLoginAttempts +lockedUntil +tokenVersion";
```

## Model Groups

All model exports are available from:

```ts
import { User, Booking, Employee, Service } from "./models/index.js";
```

### Core Salon Models

- `Salon`: Tenant/business account.
- `SalonLocation`: Physical branch/location.
- `SalonSettings`: Currency, booking rules, cancellation rules, customer auth options, deposit defaults, reminders.
- `SalonMembership`: Staff/admin membership, role, permissions, and location scope.

### People Models

- `User`: Login identity.
- `Customer`: Salon-specific customer profile. Can exist with or without a linked `User`, so walk-ins and ERP-imported customers are supported.
- `Employee`: Salon staff profile. Supports location assignment, active/invited status, bookability, client gender routing, calendar color, level, and employment state.
- `EmployeeLevel`: Staff levels/ranks used for pricing and organization.

### Service And Capability Models

- `ServiceCategory`: Groups services for display and management.
- `Service`: Bookable salon service with price, duration phases, gender targeting, required skills, deposit policy, and location availability.
- `Skill`: Salon-defined skill/certification.
- `EmployeeSkill`: Which employee has which skill and proficiency.
- `EmployeeService`: Which employee can perform which service at which location, including overrides for price, duration, gender, and online bookability.

Service duration is split into phases:

- `applicationMinutes`
- `processingMinutes`
- `finishingMinutes`
- `bufferMinutes`

This supports real salon workflows where the employee may be free during some processing time, depending on `processingBlocksEmployee`.

### Scheduling And Calendar Models

- `LocationHours`: Opening hours by weekday and effective date range.
- `EmployeeSchedule`: Employee shifts/breaks by weekday and effective date range.
- `TimeOff`: Employee vacation/sick/personal leave.
- `CalendarBlock`: Manual or system calendar blocks such as closures, meetings, training, maintenance, travel, and holidays.
- `BookableResource`: Chairs, rooms, and equipment that can also be reserved.
- `CalendarReservation`: Actual reserved time blocks used to prevent double-booking.

Availability should be calculated as:

```text
location hours
+ employee schedules
- time off
- calendar blocks
- existing calendar reservations
= available slots
```

`CalendarReservation` is the model that protects the final booking time. It supports employees, locations, chairs, rooms, and equipment.

### Booking Models

- `Booking`: Main booking header with customer snapshot, price snapshot, cancellation snapshot, source, status, and event details.
- `BookingItem`: One service inside a booking. Stores service and employee snapshots so history remains stable even if names/prices change later.
- `WaitlistEntry`: Customer waitlist requests for time windows and preferred employees.

Booking statuses:

- `requested`
- `pending_deposit`
- `confirmed`
- `checked_in`
- `in_progress`
- `completed`
- `cancelled`
- `no_show`

Booking sources:

- `online`
- `admin`
- `walk_in`
- `api`
- `external`

The booking system supports normal, group, bridal, and offsite bookings.

### Payment Models

- `BookingPayment`: Deposit, advance, cancellation fee, no-show fee, and refund records.
- `PaymentWebhookEvent`: Idempotent webhook capture with encrypted payload storage and retry state.

Money is stored as integer minor units, for example cents. Do not store floating point money values.

This backend is only modeling booking-related payments such as deposits and advances. It is not a POS or accounting system.

### Notification Models

- `NotificationPreference`: User/customer/employee notification preferences, reminder timing, channels, locale, timezone, and marketing consent.
- `NotificationTemplate`: Per-salon templates by key, channel, and locale.
- `Notification`: Delivery queue for email, SMS, WhatsApp, and push notifications.
- `PushSubscription`: Encrypted push token storage.
- `OutboxEvent`: Reliable event publishing queue for side effects after database transactions.

Marketing notifications require recorded consent. If consent is withdrawn, marketing must be disabled.

### Integration Models

- `ExternalConnector`: Optional external ERP/POS/CRM/calendar connector configuration.
- `ExternalEntityMapping`: Maps local MongoDB records to external system IDs.
- `IntegrationSyncJob`: Async inbound/outbound sync jobs with retry state.

The local MongoDB database remains the canonical application database. External ERP/POS integration is optional. A salon can use this backend without any external ERP.

Supported external entity mapping types:

- `customer`
- `service`
- `employee`
- `booking`
- `booking_payment`
- `calendar_block`

External connector secrets are not stored directly. The model stores a `secretReference` for a secret manager.

### Audit Model

- `AuditLog`: Append-only audit trail for user, system, and integration actions.

Audit logs cannot be updated or deleted through normal model operations.

## How Booking Should Operate

Booking creation should be implemented in a service, not in a controller.

Recommended flow:

1. Validate the request payload.
2. Read salon settings, location, customer, services, employee service capabilities, schedules, time off, and calendar blocks.
3. Calculate candidate service phases and total booking range.
4. Acquire Redis distributed locks for the resources being booked.
5. Re-check availability while holding the locks.
6. Start a MongoDB transaction.
7. Create or update the `Booking`.
8. Create `BookingItem` records.
9. Create `CalendarReservation` records for every blocking phase/resource.
10. Create `OutboxEvent` records for notifications or integration sync.
11. Commit the transaction.
12. Release Redis locks.

The key production rule is:

```text
Redis locks prevent race conditions before the write.
MongoDB transactions keep booking records internally consistent.
CalendarReservation prevents double-booking at the data level.
```

Do not trust availability results from the frontend. The frontend can display available slots, but the backend must always re-check before confirming a booking.

## Frontend Notes

Frontend developers should expect these concepts:

- Login returns a JWT and role/membership context.
- Customers may have Google login or local login.
- Admins and employees use local login only.
- Most salon-owned API calls should include a selected `salonId`.
- Admin users may belong to multiple salons in the future through `SalonMembership`.
- A customer profile can exist before the customer has a login account.
- Employees are not automatically bookable when invited. They must become active and bookable.
- Online booking should show only services, employees, and locations marked active/bookable.
- Booking confirmation must wait for backend confirmation, not frontend slot selection alone.
- Money values should be displayed from integer minor units and currency codes.
- Internal notes, secret fields, hashes, provider IDs, and hidden payloads should not be exposed in normal API responses.

## Backend Service Rules Still Needed

Some rules cannot be safely enforced by a single Mongoose schema and must be enforced in services:

- Cross-tenant checks: every referenced document must belong to the same `salonId`.
- Permission checks using `SalonMembership`.
- User role compatibility with membership and employee/customer profiles.
- Overlap checks for active `LocationHours` and `EmployeeSchedule` effective date ranges.
- Availability checks across schedules, time off, blocks, and reservations.
- Booking status transitions.
- Payment/refund consistency.
- Integration conflict resolution.
- Notification preference checks before queueing messages.

## Development Commands

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Start built app:

```bash
npm start
```

Type-check without writing to `dist`:

```bash
npx tsc --noEmit
```

Lint:

```bash
npm run lint
```

## Notes For Future Development

- Keep controllers thin and put business logic in services.
- Validate incoming request bodies before services run.
- Never accept `userId`, `role`, or permission data from the request body when the value should come from the JWT.
- Use Redis locks for booking availability and reservation writes.
- Use MongoDB transactions when creating bookings, booking items, reservations, payments, notifications, and outbox events together.
- Keep ERP/POS sync async. Do not make booking confirmation depend on an external ERP call.
- Do not write generated files to `dist`; it is produced by the TypeScript build.
- Add endpoints gradually around the model groups above.
