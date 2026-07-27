import { describe, expect, it } from "vitest";

import type { ServiceSlotCheck } from "./availability.service.js";
import {
  assertInRequestAllocationCapacity,
  assertRescheduleAssignmentsAllowed,
  buildEmployeeTravelBlocks,
} from "./booking-allocation.service.js";

const at = (value: string): Date => new Date(value);

const slot = (
  overrides: Partial<ServiceSlotCheck> & {
    employeeId: string;
    startAt: Date;
    endAt: Date;
  },
): ServiceSlotCheck => ({
  available: true,
  branchId: "branch",
  serviceId: "service",
  employeeCapacity: 1,
  timeZone: "Asia/Colombo",
  duration: {
    applicationMinutes: 60,
    processingMinutes: 0,
    finishingMinutes: 0,
    bufferMinutes: 0,
    processingBlocksEmployee: false,
  },
  phases: [
    {
      phaseKey: "application",
      startAt: overrides.startAt,
      endAt: overrides.endAt,
      blocksEmployee: true,
      units: 1,
    },
  ],
  resourceAssignments: [],
  price: {
    mode: "fixed",
    currency: "LKR",
    amountMinor: 10_000,
  },
  ...overrides,
});

describe("booking request allocation", () => {
  it("creates one deterministic travel pair for every assigned employee", () => {
    const slots = [
      slot({
        employeeId: "employee-b",
        startAt: at("2099-01-01T05:00:00.000Z"),
        endAt: at("2099-01-01T06:00:00.000Z"),
      }),
      slot({
        employeeId: "employee-a",
        startAt: at("2099-01-01T04:00:00.000Z"),
        endAt: at("2099-01-01T05:00:00.000Z"),
      }),
      slot({
        employeeId: "employee-a",
        startAt: at("2099-01-01T06:00:00.000Z"),
        endAt: at("2099-01-01T07:00:00.000Z"),
      }),
    ];

    const blocks = buildEmployeeTravelBlocks(slots, {
      travelMinutesBefore: 30,
      travelMinutesAfter: 45,
    });

    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeId: "employee-a",
          itemIndex: 1,
          phaseKey: "travel:before:employee-a",
          startAt: at("2099-01-01T03:30:00.000Z"),
          endAt: at("2099-01-01T04:00:00.000Z"),
        }),
        expect.objectContaining({
          employeeId: "employee-a",
          itemIndex: 2,
          phaseKey: "travel:after:employee-a",
          startAt: at("2099-01-01T07:00:00.000Z"),
          endAt: at("2099-01-01T07:45:00.000Z"),
        }),
        expect.objectContaining({
          employeeId: "employee-b",
          itemIndex: 0,
          phaseKey: "travel:before:employee-b",
        }),
        expect.objectContaining({
          employeeId: "employee-b",
          itemIndex: 0,
          phaseKey: "travel:after:employee-b",
        }),
      ]),
    );
    expect(blocks).toHaveLength(4);
    expect(() =>
      assertInRequestAllocationCapacity(slots, blocks),
    ).not.toThrow();
  });

  it("allows overlapping bridal work assigned to different employees", () => {
    const slots = [
      slot({
        employeeId: "employee-a",
        startAt: at("2099-01-01T04:00:00.000Z"),
        endAt: at("2099-01-01T05:00:00.000Z"),
      }),
      slot({
        employeeId: "employee-b",
        startAt: at("2099-01-01T04:00:00.000Z"),
        endAt: at("2099-01-01T05:00:00.000Z"),
      }),
    ];

    expect(() => assertInRequestAllocationCapacity(slots)).not.toThrow();
  });

  it("rejects overlapping allocations on a capacity-one resource", () => {
    const sharedResource = {
      resourceType: "chair" as const,
      resourceId: "chair-1",
      capacity: 1,
      phaseKey: "resource:chair",
      startAt: at("2099-01-01T04:00:00.000Z"),
      endAt: at("2099-01-01T05:00:00.000Z"),
      units: 1 as const,
    };
    const slots = [
      slot({
        employeeId: "employee-a",
        startAt: sharedResource.startAt,
        endAt: sharedResource.endAt,
        resourceAssignments: [sharedResource],
      }),
      slot({
        employeeId: "employee-b",
        startAt: sharedResource.startAt,
        endAt: sharedResource.endAt,
        resourceAssignments: [sharedResource],
      }),
    ];

    expect(() => assertInRequestAllocationCapacity(slots)).toThrowError(
      expect.objectContaining({
        code: "BOOKING_RESOURCE_CAPACITY_EXCEEDED",
      }),
    );
  });

  it("honors an employee's concurrent-client capacity", () => {
    const slots = [
      slot({
        employeeId: "employee-a",
        employeeCapacity: 2,
        startAt: at("2099-01-01T04:00:00.000Z"),
        endAt: at("2099-01-01T05:00:00.000Z"),
      }),
      slot({
        employeeId: "employee-a",
        employeeCapacity: 2,
        startAt: at("2099-01-01T04:30:00.000Z"),
        endAt: at("2099-01-01T05:30:00.000Z"),
      }),
    ];

    expect(() => assertInRequestAllocationCapacity(slots)).not.toThrow();
    slots[0] = { ...slots[0], employeeCapacity: 1 };
    slots[1] = { ...slots[1], employeeCapacity: 1 };
    expect(() => assertInRequestAllocationCapacity(slots)).toThrowError(
      expect.objectContaining({
        code: "BOOKING_EMPLOYEE_CAPACITY_EXCEEDED",
      }),
    );
  });

  it("allows staff reassignment but never customer reassignment", () => {
    const existing = [
      {
        serviceId: { toString: () => "service-a" },
        employeeId: { toString: () => "employee-a" },
      },
    ];
    const reassigned = [
      {
        serviceId: "service-a",
        employeeId: "employee-b",
      },
    ];

    expect(() =>
      assertRescheduleAssignmentsAllowed(existing, reassigned, false),
    ).not.toThrow();
    expect(() =>
      assertRescheduleAssignmentsAllowed(existing, reassigned, true),
    ).toThrowError(
      expect.objectContaining({ code: "RESCHEDULE_ITEM_MISMATCH" }),
    );
    expect(() =>
      assertRescheduleAssignmentsAllowed(
        existing,
        [{ serviceId: "service-b", employeeId: "employee-b" }],
        false,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "RESCHEDULE_ITEM_MISMATCH" }),
    );
  });
});
