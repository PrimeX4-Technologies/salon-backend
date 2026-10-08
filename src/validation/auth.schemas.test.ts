import { describe, expect, it } from "vitest";

import {
  customerRegistrationSchema,
  loginSchema,
} from "./auth.schemas.js";
import { localStaffAccountSchema } from "./staff.schemas.js";

describe("authentication request schemas", () => {
  it("requires a minimum length without composition rules for new passwords", () => {
    const customer = {
      name: "Customer Name",
      email: "customer@example.com",
      password: "alllowercase",
    };
    const staff = {
      name: "Staff Name",
      email: "staff@example.com",
      password: "alllowercase",
    };

    expect(customerRegistrationSchema.safeParse(customer).success).toBe(true);
    expect(localStaffAccountSchema.safeParse(staff).success).toBe(true);
    expect(
      customerRegistrationSchema.safeParse({
        ...customer,
        password: "StrongPassword1",
      }).success,
    ).toBe(true);
    expect(
      localStaffAccountSchema.safeParse({
        ...staff,
        password: "StrongPassword1",
      }).success,
    ).toBe(true);
  });

  it("keeps login compatible with an existing password after policies tighten", () => {
    expect(
      loginSchema.safeParse({
        identifier: "customer@example.com",
        password: "legacy-password",
      }).success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({
        identifier: "0786766354",
        password: "old",
      }).success,
    ).toBe(true);
  });

  it("normalizes Sri Lankan local mobile numbers for registration", () => {
    const result = customerRegistrationSchema.safeParse({
      name: "Customer Name",
      phone: "0786766354",
      password: "password",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+94786766354");
  });
});
