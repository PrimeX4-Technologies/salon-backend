import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import {
  assertEmployeeAccessStatus,
  assertEmployeeManagementScope,
} from "./employee.service.js";
import {
  createEmployeeBodySchema,
  provisionEmployeeAccountBodySchema,
} from "../validation/staff.schemas.js";

const account = {
  name: "Salon Employee",
  email: "employee@example.com",
  password: "StrongPass123",
};

const activeAccess = {
  permissions: [],
  allBranches: true,
  branchIds: [],
  status: "active" as const,
};

describe("employee access policy", () => {
  it("rejects active access for an invited employee at the API boundary", () => {
    const result = createEmployeeBodySchema.safeParse({
      employeeCode: "EMP-1",
      name: "Salon Employee",
      account,
      access: activeAccess,
    });

    expect(result.success).toBe(false);
  });

  it("rejects active access when account provisioning does not activate the employee", () => {
    const result = provisionEmployeeAccountBodySchema.safeParse({
      account,
      access: activeAccess,
      activateEmployee: false,
    });

    expect(result.success).toBe(false);
  });

  it("allows active access only for active or on-leave employees", () => {
    expect(() => assertEmployeeAccessStatus("active", "active")).not.toThrow();
    expect(() => assertEmployeeAccessStatus("on_leave", "active")).not.toThrow();
    expect(() => assertEmployeeAccessStatus("invited", "active")).toThrowError(
      expect.objectContaining({ code: "EMPLOYEE_STATUS_ACCESS_CONFLICT" }),
    );
  });

  it("requires every assigned branch for global employee mutations", () => {
    const branchA = new Types.ObjectId();
    const branchB = new Types.ObjectId();

    expect(() =>
      assertEmployeeManagementScope(
        {
          allBranches: false,
          branchIds: [branchA.toString(), branchB.toString()],
          permissions: ["manage_staff"],
        },
        [branchA, branchB],
      ),
    ).not.toThrow();

    expect(() =>
      assertEmployeeManagementScope(
        {
          allBranches: false,
          branchIds: [branchA.toString()],
          permissions: ["manage_staff"],
        },
        [branchA, branchB],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "EMPLOYEE_FULL_BRANCH_SCOPE_REQUIRED",
      }),
    );
  });
});
