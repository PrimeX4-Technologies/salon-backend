import { Temporal } from "@js-temporal/polyfill";

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

export const localDateTimeToDate = (localDate: string, localTime: string): Date => {
  const plainDate = Temporal.PlainDate.from(localDate);
  const plainTime = Temporal.PlainTime.from(localTime);
  const instant = plainDate
    .toPlainDateTime(plainTime)
    .toZonedDateTime(SYSTEM_TIME_ZONE)
    .toInstant();
  return new Date(instant.epochMilliseconds);
};

export const dateToSystemPlainDate = (value: Date): string =>
  Temporal.Instant.fromEpochMilliseconds(value.getTime())
    .toZonedDateTimeISO(SYSTEM_TIME_ZONE)
    .toPlainDate()
    .toString();

export const systemDayOfWeek = (localDate: string): number =>
  Temporal.PlainDate.from(localDate).dayOfWeek % 7;

export const addLocalDays = (localDate: string, days: number): string =>
  Temporal.PlainDate.from(localDate).add({ days }).toString();

export const compareLocalDates = (left: string, right: string): number =>
  Temporal.PlainDate.compare(Temporal.PlainDate.from(left), Temporal.PlainDate.from(right));
