import mongoose, { type Model, Schema } from "mongoose";

export const getOrCreateModel = <T>(name: string, schema: Schema<T>): Model<T> =>
  (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;

export const normalizeEmail = (value?: string | null): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
};

export const normalizePhone = (value?: string | null): string | undefined => {
  const normalized = value?.trim().replace(/[\s().-]/g, "");
  return normalized || undefined;
};

export const normalizeCode = (value: string): string => value.trim().toUpperCase();

export const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export const isValidTimeZone = (value: string): boolean => {
  try {
    Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const isSafeExternalHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.")
    ) {
      return false;
    }

    const ipv4Parts = hostname.split(".").map(Number);
    if (
      ipv4Parts.length === 4 &&
      ipv4Parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      ipv4Parts[0] === 172 &&
      ipv4Parts[1] >= 16 &&
      ipv4Parts[1] <= 31
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

export const timeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export interface IAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
}

export const AddressSchema = new Schema<IAddress>(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 32 },
    countryCode: {
      type: String,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 2,
    },
  },
  { _id: false },
);

export interface ITimeInterval {
  start: string;
  end: string;
}

export const TimeIntervalSchema = new Schema<ITimeInterval>(
  {
    start: { type: String, required: true, match: TIME_PATTERN },
    end: { type: String, required: true, match: TIME_PATTERN },
  },
  { _id: false },
);

export const intervalsAreValid = (intervals: ITimeInterval[]): boolean => {
  const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  return sorted.every((interval, index) => {
    const startsBeforeEnd = timeToMinutes(interval.start) < timeToMinutes(interval.end);
    const previous = sorted[index - 1];
    const doesNotOverlapPrevious = !previous || timeToMinutes(previous.end) <= timeToMinutes(interval.start);
    return startsBeforeEnd && doesNotOverlapPrevious;
  });
};
