import { describe, expect, it } from "vitest";

import {
  customerRegistrationSchema,
  loginSchema,
} from "./auth.schemas.js";
import { localStaffAccountSchema } from "./staff.schemas.js";

describe("authentication request schemas", () => {
  it("applies the strong new-password policy to customers and staff", () => {
    const customer = {
      name: "Customer Name",
      email: "customer@example.com",
      password: "lowercase1",
    };
    const staff = {
      name: "Staff Name",
      email: "staff@example.com",
      password: "lowercase1",
    };

    expect(customerRegistrationSchema.safeParse(customer).success).toBe(false);
    expect(localStaffAccountSchema.safeParse(staff).success).toBe(false);
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
  });
});
