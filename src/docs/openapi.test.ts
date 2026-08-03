import { describe, expect, it } from "vitest";

import { openApiDocument } from "./openapi.js";

type JsonObject = Record<string, unknown>;

const httpMethods = new Set(["get", "post", "put", "patch", "delete"]);

const operations = Object.entries(openApiDocument.paths).flatMap(
  ([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => httpMethods.has(method))
      .map(([method, operation]) => ({
        key: `${method} ${path}`,
        operation: operation as JsonObject,
      })),
);

const resolveLocalRef = (reference: string): unknown => {
  const segments = reference.replace(/^#\//, "").split("/");
  let current: unknown = openApiDocument;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as JsonObject)[segment];
  }
  return current;
};

const collectRefs = (value: unknown, refs: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key === "$ref" && typeof child === "string") refs.push(child);
    else collectRefs(child, refs);
  }
  return refs;
};

describe("OpenAPI contract", () => {
  it("documents every Express API route plus the four system checks", () => {
    // There are 202 method registrations in src/api/routes/*.routes.ts.
    expect(operations).toHaveLength(206);
    expect(new Set(operations.map(({ key }) => key)).size).toBe(206);
  });

  it("contains only resolvable local component references", () => {
    const references = collectRefs(openApiDocument);
    expect(references.length).toBeGreaterThan(500);
    for (const reference of references) {
      expect(reference.startsWith("#/"), reference).toBe(true);
      expect(resolveLocalRef(reference), reference).toBeDefined();
    }
  });

  it("uses concrete request components and typed success/error responses", () => {
    expect(openApiDocument.components.schemas).not.toHaveProperty(
      "GenericJsonBody",
    );
    expect(openApiDocument.components.schemas).not.toHaveProperty(
      "OperationResult",
    );

    for (const { key, operation } of operations) {
      expect(operation.parameters, key).toBeInstanceOf(Array);
      expect(operation.responses, key).toBeTypeOf("object");

      const responses = operation.responses as JsonObject;
      const successfulResponses = Object.entries(responses).filter(
        ([status]) => /^2\d\d$/.test(status),
      );
      expect(successfulResponses.length, key).toBeGreaterThan(0);
      for (const [status, responseValue] of successfulResponses) {
        const response = responseValue as JsonObject;
        expect(response.headers, `${key} ${status}`).toBeTypeOf("object");
        if (status === "204") {
          expect(response.content, key).toBeUndefined();
          continue;
        }
        const responseContent = response.content as JsonObject;
        const responseMedia = responseContent["application/json"] as JsonObject;
        expect(responseMedia.schema, `${key} ${status}`).toBeTypeOf("object");
      }

      const requestBody = operation.requestBody as JsonObject | undefined;
      if (!requestBody) continue;
      const content = requestBody.content as JsonObject;
      const jsonMedia = content["application/json"] as JsonObject | undefined;
      if (!jsonMedia) continue;
      const schema = jsonMedia.schema as JsonObject;
      const reference = schema.$ref;
      if (typeof reference === "string") {
        expect(reference, key).not.toContain("Generic");
        expect(resolveLocalRef(reference), key).toBeDefined();
      } else {
        expect(key).toContain("/webhooks/payments/");
      }
    }
  });

  it("documents required idempotency and exact pagination contracts", () => {
    const bookingCreate = openApiDocument.paths["/api/v1/customer/bookings"]
      ?.post as JsonObject;
    const parameters = bookingCreate.parameters as JsonObject[];
    expect(parameters).toContainEqual({
      $ref: "#/components/parameters/IdempotencyKey",
    });

    const listCustomers = openApiDocument.paths["/api/v1/customers"]
      ?.get as JsonObject;
    const responses = listCustomers.responses as JsonObject;
    const ok = responses["200"] as JsonObject;
    const content = ok.content as JsonObject;
    const media = content["application/json"] as JsonObject;
    const envelope = media.schema as JsonObject;
    expect(JSON.stringify(envelope)).toContain(
      "#/components/schemas/PaginationMeta",
    );
  });

  it("documents compact lifecycle and public-hours payloads accurately", () => {
    const bookingCancel = openApiDocument.paths[
      "/api/v1/customer/bookings/{bookingId}/cancel"
    ]?.post as JsonObject;
    expect(JSON.stringify(bookingCancel.responses)).toContain(
      "#/components/schemas/BookingLifecycleResult",
    );

    const expireHolds = openApiDocument.paths[
      "/api/v1/staff/bookings/expire-holds"
    ]?.post as JsonObject;
    expect(JSON.stringify(expireHolds.responses)).toContain(
      "#/components/schemas/ExpirationResult",
    );

    const publicHours = openApiDocument.paths[
      "/api/v1/public/branches/{branchId}/hours"
    ]?.get as JsonObject;
    expect(JSON.stringify(publicHours.responses)).toContain(
      "#/components/schemas/PublicBranchHours",
    );
  });
});
