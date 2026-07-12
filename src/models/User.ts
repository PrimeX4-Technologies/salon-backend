import bcrypt from "bcrypt";
import mongoose, { type HydratedDocument, type Model, Schema } from "mongoose";

import {
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  normalizeEmail,
  normalizePhone,
} from "./shared.js";

export const USER_ROLES = ["admin", "employee", "customer"] as const;
export const AUTH_METHODS = ["local", "google"] as const;
export const USER_AUTH_SELECT = "+password +failedLoginAttempts +lockedUntil +tokenVersion";

export type UserRole = (typeof USER_ROLES)[number];
export type AuthMethod = (typeof AUTH_METHODS)[number];

export interface IUser {
  name: string;
  email?: string;
  phone?: string;
  password?: string;
  googleId?: string;
  authMethods: AuthMethod[];
  role: UserRole;
  avatarUrl?: string;
  isActive: boolean;
  emailVerifiedAt?: Date;
  phoneVerifiedAt?: Date;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidatePassword: string): Promise<boolean>;
  isLocked(): boolean;
}

export type UserModel = Model<IUser, Record<string, never>, IUserMethods>;
export type UserDocument = HydratedDocument<IUser, IUserMethods>;

const AUTH_PROTECTED_FIELDS = new Set([
  "email",
  "phone",
  "password",
  "googleId",
  "authMethods",
  "role",
  "emailVerifiedAt",
  "phoneVerifiedAt",
  "passwordChangedAt",
  "tokenVersion",
]);

const modifiesAuthenticationData = (update: unknown): boolean => {
  if (Array.isArray(update)) return true;
  if (!update || typeof update !== "object") return false;

  return Object.entries(update as Record<string, unknown>).some(([path, value]) => {
    if (path.startsWith("$")) return modifiesAuthenticationData(value);
    return AUTH_PROTECTED_FIELDS.has(path.split(".")[0]);
  });
};

const UserSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    email: {
      type: String,
      set: normalizeEmail,
      match: EMAIL_PATTERN,
      maxlength: 254,
    },
    phone: {
      type: String,
      set: normalizePhone,
      match: [E164_PHONE_PATTERN, "Phone must use E.164 format, for example +94771234567"],
    },
    password: { type: String, select: false, minlength: 8, maxlength: 200 },
    googleId: { type: String, trim: true, maxlength: 255 },
    authMethods: {
      type: [{ type: String, enum: AUTH_METHODS }],
      default: ["local"],
      required: true,
    },
    role: { type: String, enum: USER_ROLES, required: true, default: "customer", index: true },
    avatarUrl: { type: String, trim: true, maxlength: 2048 },
    isActive: { type: Boolean, default: true, index: true },
    emailVerifiedAt: Date,
    phoneVerifiedAt: Date,
    lastLoginAt: Date,
    passwordChangedAt: Date,
    failedLoginAttempts: { type: Number, default: 0, min: 0, select: false },
    lockedUntil: { type: Date, select: false },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      transform: (_document, returnedObject) => {
        const safe = returnedObject as Record<string, unknown>;
        delete safe.password;
        delete safe.googleId;
        delete safe.failedLoginAttempts;
        delete safe.lockedUntil;
        delete safe.tokenVersion;
        delete safe.__v;
        return safe;
      },
    },
  },
);

UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } },
);
UserSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string" } } },
);
UserSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: "string" } } },
);

UserSchema.pre("validate", function () {
  this.authMethods = [...new Set(this.authMethods ?? [])];

  if (!this.email && !this.phone) {
    this.invalidate("email", "An email address or E.164 mobile number is required");
  }

  const hasLocalAuth = this.authMethods.includes("local");
  const hasGoogleAuth = this.authMethods.includes("google");

  if (this.isModified("authMethods") && !hasLocalAuth) {
    this.password = undefined;
    this.passwordChangedAt = undefined;
    this.markModified("password");
  }

  if (this.authMethods.length === 0) {
    this.invalidate("authMethods", "At least one authentication method is required");
  }

  const localAuthConfigurationChanged =
    this.isNew || this.isModified("authMethods") || this.isModified("role");
  if (localAuthConfigurationChanged && hasLocalAuth && !this.password && !this.passwordChangedAt) {
    this.invalidate("password", "A password is required for local authentication");
  }

  if (this.password && !hasLocalAuth) {
    this.invalidate("authMethods", "Local authentication must be enabled when a password is set");
  }

  if (this.password && Buffer.byteLength(this.password, "utf8") > 72) {
    this.invalidate("password", "Password cannot exceed 72 UTF-8 bytes when using bcrypt");
  }

  if (hasGoogleAuth && this.role !== "customer") {
    this.invalidate("authMethods", "Google authentication is available only to customers");
  }

  if (hasGoogleAuth && !this.googleId) {
    this.invalidate("googleId", "A verified Google subject is required for Google authentication");
  }

  if (hasGoogleAuth && !this.email) {
    this.invalidate("email", "Google authentication requires an email address");
  }

  if (this.googleId && !hasGoogleAuth) {
    this.invalidate("authMethods", "Google authentication must be enabled when a Google subject is set");
  }

  if (this.role !== "customer" && (!hasLocalAuth || hasGoogleAuth)) {
    this.invalidate("authMethods", "Admins and employees must use local authentication only");
  }
});

UserSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;

  this.password = await bcrypt.hash(this.password, 12);
  this.passwordChangedAt = new Date();
});

UserSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  if (modifiesAuthenticationData(this.getUpdate())) {
    throw new Error("Authentication fields must be changed on a User document with save()");
  }
});

UserSchema.pre(["replaceOne", "findOneAndReplace"], function () {
  throw new Error("User replacements are disabled; load the document and call save()");
});

UserSchema.pre("insertMany", function () {
  throw new Error("User.insertMany() is disabled because it bypasses password hashing");
});

UserSchema.pre("bulkWrite", function () {
  throw new Error("User.bulkWrite() is disabled because it can bypass credential safeguards");
});

UserSchema.method("comparePassword", async function (candidatePassword: string): Promise<boolean> {
  if (!this.isSelected("password")) {
    throw new Error(`Password hash was not selected; use .select("${USER_AUTH_SELECT}")`);
  }
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
});

UserSchema.method("isLocked", function (): boolean {
  if (!this.isSelected("lockedUntil")) {
    throw new Error(`Lock state was not selected; use .select("${USER_AUTH_SELECT}")`);
  }
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
});

export { UserSchema };

const User =
  (mongoose.models.User as UserModel | undefined) ?? mongoose.model<IUser, UserModel>("User", UserSchema);

export default User;
