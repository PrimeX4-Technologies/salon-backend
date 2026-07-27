import type { ServiceSlotCheck } from "./availability.service.js";
import { ApiError } from "../utils/ApiError.js";
import { canAllocateCapacity, type CapacityRange } from "../utils/availability.js";

/**
 * Employee reservations normally consume one concurrent-client unit. Travel is
 * exclusive, so it consumes the model's maximum supported employee capacity.
 */
export const EXCLUSIVE_EMPLOYEE_RESERVATION_UNITS = 5;

export interface BookingTravelPolicy {
  travelMinutesBefore: number;
  travelMinutesAfter: number;
}

export interface EmployeeTravelBlock {
  employeeId: string;
  itemIndex: number;
  position: "before" | "after";
  phaseKey: string;
  startAt: Date;
  endAt: Date;
  reservationUnits: number;
}

interface ExistingRescheduleAssignment {
  serviceId: { toString(): string };
  employeeId: { toString(): string };
}

interface RequestedRescheduleAssignment {
  serviceId: string;
  employeeId: string;
}

export const assertRescheduleAssignmentsAllowed = (
  existing: readonly ExistingRescheduleAssignment[],
  requested: readonly RequestedRescheduleAssignment[],
  customerView: boolean,
): void => {
  if (requested.length !== existing.length) {
    throw ApiError.badRequest(
      "Rescheduling cannot add or remove services",
      undefined,
      "RESCHEDULE_ITEM_MISMATCH",
    );
  }
  existing.forEach((item, index) => {
    const replacement = requested[index];
    if (
      !replacement ||
      item.serviceId.toString() !== replacement.serviceId ||
      (customerView &&
        item.employeeId.toString() !== replacement.employeeId)
    ) {
      throw ApiError.badRequest(
        customerView
          ? "Customers can change appointment times only; service and employee must stay unchanged"
          : "Rescheduling cannot change the booked services",
        undefined,
        "RESCHEDULE_ITEM_MISMATCH",
      );
    }
  });
};

const byFirstAssignment = (
  left: { slot: ServiceSlotCheck; itemIndex: number },
  right: { slot: ServiceSlotCheck; itemIndex: number },
): number =>
  left.slot.startAt.getTime() - right.slot.startAt.getTime() ||
  left.slot.endAt.getTime() - right.slot.endAt.getTime() ||
  left.itemIndex - right.itemIndex;

const byLastAssignment = (
  left: { slot: ServiceSlotCheck; itemIndex: number },
  right: { slot: ServiceSlotCheck; itemIndex: number },
): number =>
  right.slot.endAt.getTime() - left.slot.endAt.getTime() ||
  right.slot.startAt.getTime() - left.slot.startAt.getTime() ||
  right.itemIndex - left.itemIndex;

/**
 * Travel applies once per employee, outside that employee's first and last
 * service assignment. This avoids double-counting travel for bridal/event
 * bookings where one employee performs multiple service items.
 */
export const buildEmployeeTravelBlocks = (
  slots: readonly ServiceSlotCheck[],
  policy: BookingTravelPolicy,
): EmployeeTravelBlock[] => {
  if (
    policy.travelMinutesBefore <= 0 &&
    policy.travelMinutesAfter <= 0
  ) {
    return [];
  }

  const assignmentsByEmployee = new Map<
    string,
    Array<{ slot: ServiceSlotCheck; itemIndex: number }>
  >();
  slots.forEach((slot, itemIndex) => {
    const assignments = assignmentsByEmployee.get(slot.employeeId) ?? [];
    assignments.push({ slot, itemIndex });
    assignmentsByEmployee.set(slot.employeeId, assignments);
  });

  const blocks: EmployeeTravelBlock[] = [];
  for (const [employeeId, assignments] of [
    ...assignmentsByEmployee.entries(),
  ].sort(([left], [right]) => left.localeCompare(right))) {
    const first = [...assignments].sort(byFirstAssignment)[0];
    const last = [...assignments].sort(byLastAssignment)[0];
    if (!first || !last) continue;

    if (policy.travelMinutesBefore > 0) {
      blocks.push({
        employeeId,
        itemIndex: first.itemIndex,
        position: "before",
        phaseKey: `travel:before:${employeeId}`,
        startAt: new Date(
          first.slot.startAt.getTime() -
            policy.travelMinutesBefore * 60_000,
        ),
        endAt: new Date(first.slot.startAt),
        reservationUnits: EXCLUSIVE_EMPLOYEE_RESERVATION_UNITS,
      });
    }
    if (policy.travelMinutesAfter > 0) {
      blocks.push({
        employeeId,
        itemIndex: last.itemIndex,
        position: "after",
        phaseKey: `travel:after:${employeeId}`,
        startAt: new Date(last.slot.endAt),
        endAt: new Date(
          last.slot.endAt.getTime() +
            policy.travelMinutesAfter * 60_000,
        ),
        reservationUnits: EXCLUSIVE_EMPLOYEE_RESERVATION_UNITS,
      });
    }
  }

  return blocks.sort(
    (left, right) =>
      left.startAt.getTime() - right.startAt.getTime() ||
      left.endAt.getTime() - right.endAt.getTime() ||
      left.employeeId.localeCompare(right.employeeId) ||
      left.position.localeCompare(right.position),
  );
};

const allocationRange = (
  value: Pick<{ startAt: Date; endAt: Date }, "startAt" | "endAt">,
  units: number,
): CapacityRange => ({
  start: value.startAt.getTime(),
  end: value.endAt.getTime(),
  units,
});

/**
 * Slot checks run in parallel and therefore cannot see allocations from sibling
 * items in the same request. Validate the complete proposed allocation after
 * both the optimistic check and the lock-protected recheck.
 */
export const assertInRequestAllocationCapacity = (
  slots: readonly ServiceSlotCheck[],
  travelBlocks: readonly EmployeeTravelBlock[] = [],
): void => {
  const employeeAllocations = new Map<
    string,
    { capacity: number; ranges: CapacityRange[] }
  >();
  for (const slot of slots) {
    const allocation = employeeAllocations.get(slot.employeeId) ?? {
      capacity: slot.employeeCapacity,
      ranges: [],
    };
    if (allocation.capacity !== slot.employeeCapacity) {
      throw ApiError.conflict(
        "Employee capacity changed while checking the booking",
        "BOOKING_CONFIGURATION_CHANGED",
      );
    }
    allocation.ranges.push(
      ...slot.phases.map((phase) => allocationRange(phase, phase.units)),
    );
    employeeAllocations.set(slot.employeeId, allocation);
  }
  for (const travel of travelBlocks) {
    const allocation = employeeAllocations.get(travel.employeeId);
    if (!allocation) {
      throw ApiError.conflict(
        "Travel allocation does not match a booking employee",
        "BOOKING_CONFIGURATION_CHANGED",
      );
    }
    // Travel is exclusive regardless of the employee's normal concurrency.
    allocation.ranges.push(allocationRange(travel, allocation.capacity));
  }
  for (const [employeeId, allocation] of employeeAllocations) {
    if (
      !canAllocateCapacity([], allocation.ranges, allocation.capacity)
    ) {
      throw ApiError.conflict(
        "Items in this booking exceed an employee's concurrent-client capacity",
        { employeeId, capacity: allocation.capacity },
        "BOOKING_EMPLOYEE_CAPACITY_EXCEEDED",
      );
    }
  }

  const resourceAllocations = new Map<
    string,
    { capacity: number; ranges: CapacityRange[] }
  >();
  for (const slot of slots) {
    for (const resource of slot.resourceAssignments) {
      const key = `${resource.resourceType}:${resource.resourceId}`;
      const allocation = resourceAllocations.get(key) ?? {
        capacity: resource.capacity,
        ranges: [],
      };
      if (allocation.capacity !== resource.capacity) {
        throw ApiError.conflict(
          "Resource capacity changed while checking the booking",
          "BOOKING_CONFIGURATION_CHANGED",
        );
      }
      allocation.ranges.push(allocationRange(resource, resource.units));
      resourceAllocations.set(key, allocation);
    }
  }
  for (const [resource, allocation] of resourceAllocations) {
    if (
      !canAllocateCapacity([], allocation.ranges, allocation.capacity)
    ) {
      throw ApiError.conflict(
        "Items in this booking exceed a salon resource's capacity",
        { resource, capacity: allocation.capacity },
        "BOOKING_RESOURCE_CAPACITY_EXCEEDED",
      );
    }
  }
};
