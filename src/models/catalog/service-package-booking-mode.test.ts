import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { packageCreateSchema } from "../../api/validators/catalog.validators.js";
import ServicePackage from "./ServicePackage.js";

const categoryId = new Types.ObjectId();
const serviceId = new Types.ObjectId();

const packageInput = {
  categoryId: categoryId.toString(),
  code: "BRIDAL",
  name: "Bridal package",
  slug: "bridal-package",
  serviceComponents: [
    {
      serviceId: serviceId.toString(),
      quantity: 1,
    },
  ],
  price: {
    mode: "starting_from" as const,
    currency: "LKR",
    fromAmountMinor: 100_000,
  },
};

describe("service package booking mode", () => {
  it("does not advertise unsupported instant package booking through the API", () => {
    expect(
      packageCreateSchema.safeParse({
        body: {
          ...packageInput,
          bookingMode: "instant",
        },
      }).success,
    ).toBe(false);
    expect(
      packageCreateSchema.safeParse({
        body: {
          ...packageInput,
          bookingMode: "request_quote",
        },
      }).success,
    ).toBe(true);
  });

  it("enforces inquiry-based package booking at the persistence boundary", async () => {
    const servicePackage = new ServicePackage({
      ...packageInput,
      categoryId,
      serviceComponents: [{ serviceId, quantity: 1 }],
      bookingMode: "instant",
    });

    await expect(servicePackage.validate()).rejects.toMatchObject({
      name: "ValidationError",
    });

    servicePackage.bookingMode = "request_quote";
    await expect(servicePackage.validate()).resolves.toBeUndefined();
  });
});
