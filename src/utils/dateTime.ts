import { config } from "../config/env.js";

export const SYSTEM_TIME_ZONE = config.TIME_ZONE;

export const formatInSystemTimeZone = (
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = {},
  locale = "en-LK",
): string => {
  const formatOptions: Intl.DateTimeFormatOptions =
    Object.keys(options).length > 0
      ? options
      : { dateStyle: "medium", timeStyle: "short" };

  return new Intl.DateTimeFormat(locale, {
    ...formatOptions,
    timeZone: SYSTEM_TIME_ZONE,
  }).format(new Date(value));
};

export const currentSystemDate = (): string => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: SYSTEM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
};

export const isDateWithExplicitOffset = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  );
