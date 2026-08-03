import { describe, expect, it } from "vitest";

import {
  connectorBodySchema,
  updateConnectorBodySchema,
} from "./integration.schemas.js";
import {
  updateNotificationTemplateBodySchema,
} from "./notification.schemas.js";
import {
  createAdvanceCheckoutBodySchema,
  recordAdvanceBodySchema,
} from "./payment.schemas.js";

const objectId = "507f1f77bcf86cd799439011";

describe("operational request schemas", () => {
  it("accepts secret-manager references and never accepts raw credentials", () => {
    const baseConnector = {
      name: "Existing ERP",
      provider: "existing_erp",
      type: "erp_pos" as const,
      scope: "business" as const,
      syncPolicies: [],
    };

    expect(
      connectorBodySchema.safeParse({
        ...baseConnector,
        secretReference: "vault://salon/production/erp",
      }).success,
    ).toBe(true);
    expect(
      connectorBodySchema.safeParse({
        ...baseConnector,
        secretReference: "username:password",
      }).success,
    ).toBe(false);
  });

  it("allows a true partial connector update without injecting create defaults", () => {
    const result = updateConnectorBodySchema.safeParse({ name: "Renamed ERP" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: "Renamed ERP" });
  });

  it("loads the partial notification-template schema without losing strictness", () => {
    expect(
      updateNotificationTemplateBodySchema.safeParse({ body: "Updated" })
        .success,
    ).toBe(true);
    expect(
      updateNotificationTemplateBodySchema.safeParse({
        body: "Updated",
        credentials: "secret",
      }).success,
    ).toBe(false);
  });

  it("requires external transaction evidence for a staff-recorded payment", () => {
    expect(
      recordAdvanceBodySchema.safeParse({
        bookingId: objectId,
        provider: "gateway",
        amountMinor: 1000,
        currency: "lkr",
      }).success,
    ).toBe(false);
    expect(
      recordAdvanceBodySchema.safeParse({
        bookingId: objectId,
        provider: "gateway",
        providerTransactionId: "txn_123",
        amountMinor: 1000,
        currency: "lkr",
      }).success,
    ).toBe(true);
  });

  it("does not allow the manual pseudo-provider for customer checkouts", () => {
    expect(
      createAdvanceCheckoutBodySchema.safeParse({
        bookingId: objectId,
        provider: "manual",
      }).success,
    ).toBe(false);
  });
});

