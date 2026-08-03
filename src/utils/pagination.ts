import { ApiError } from "./ApiError.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  field: string,
): number => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw ApiError.badRequest(`${field} must be a positive integer`, undefined, "INVALID_PAGINATION");
  }
  return parsed;
};

export const parsePagination = (
  query: Record<string, unknown>,
  maxLimit = MAX_LIMIT,
): Pagination => {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE, "page");
  const requestedLimit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, "limit");
  const limit = Math.min(requestedLimit, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

export const buildPaginationMeta = (
  total: number,
  pagination: Pick<Pagination, "page" | "limit">,
): PaginationMeta => {
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit));
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages,
    hasNextPage: pagination.page < totalPages,
    hasPreviousPage: pagination.page > 1,
  };
};

export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parseSort = <T extends string>(
  value: unknown,
  allowedFields: readonly T[],
  fallback: `${"" | "-"}${T}`,
): Record<string, 1 | -1> => {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const direction = raw.startsWith("-") ? -1 : 1;
  const field = (raw.startsWith("-") ? raw.slice(1) : raw) as T;
  if (!allowedFields.includes(field)) {
    throw ApiError.badRequest("Unsupported sort field", { allowedFields }, "INVALID_SORT");
  }
  return { [field]: direction };
};
