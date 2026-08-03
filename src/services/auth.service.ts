import bcrypt from "bcrypt";
import mongoose, { type ClientSession } from "mongoose";

import { config } from "../config/env.js";
import BusinessSettings from "../models/business/BusinessSettings.js";
import User, {
  USER_AUTH_SELECT,
  type UserDocument,
  type UserRole,
} from "../models/auth/User.js";
import Customer from "../models/customers/Customer.js";
import OutboxEvent from "../models/events/OutboxEvent.js";
import { normalizeEmail, normalizePhone } from "../models/core/shared.js";
import type {
  ChangePasswordInput,
  ConfirmEmailInput,
  CustomerRegistrationInput,
  ForgotPasswordInput,
  GoogleLoginInput,
  LoginInput,
  ResetPasswordInput,
} from "../validation/auth.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import type {
  AuthResult,
  AuthSessionSummary,
  PublicUser,
} from "../types/auth.js";
import { actionTokenService } from "./action-token.service.js";
import {
  googleIdentityVerifier,
  type GoogleIdentityVerifier,
} from "./google-auth.service.js";
import {
  tokenService,
  RefreshTokenReuseError,
  type SessionContext,
  type TokenService,
} from "./token.service.js";

const DUMMY_PASSWORD_HASH =
  "$2b$12$uQS939YrQULwDzUE9RVii.w4NB2461j7yhH7/MZyZeTBQKzjWdK2O";

export interface CreateLocalUserInput {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  role: UserRole;
}

export interface CreateLocalUserOptions {
  session?: ClientSession;
}

const toPublicUser = (user: UserDocument): PublicUser => ({
  id: user.id,
  name: user.name,
  ...(user.email ? { email: user.email } : {}),
  ...(user.phone ? { phone: user.phone } : {}),
  role: user.role,
  authMethods: [...user.authMethods],
  ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
  isActive: user.isActive,
  ...(user.emailVerifiedAt
    ? { emailVerifiedAt: user.emailVerifiedAt.toISOString() }
    : {}),
  ...(user.phoneVerifiedAt
    ? { phoneVerifiedAt: user.phoneVerifiedAt.toISOString() }
    : {}),
  ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

const normalizeIdentifier = (
  identifier: string,
): { email?: string; phone?: string } => {
  if (identifier.includes("@")) {
    return { email: normalizeEmail(identifier) };
  }
  return { phone: normalizePhone(identifier) };
};

const recordFailedLogin = async (userId: string): Promise<void> => {
  const lastAttemptBeforeLock = config.AUTH_MAX_FAILED_ATTEMPTS - 1;
  const incremented = await User.updateOne(
    {
      _id: userId,
      failedLoginAttempts: { $lt: lastAttemptBeforeLock },
    },
    { $inc: { failedLoginAttempts: 1 } },
  );

  if (incremented.matchedCount > 0) return;

  await User.updateOne(
    { _id: userId },
    {
      $inc: { failedLoginAttempts: 1 },
      $set: {
        lockedUntil: new Date(Date.now() + config.AUTH_LOCK_SECONDS * 1000),
      },
    },
  );
};

const ensureCustomerProfile = async (
  user: UserDocument,
  session?: ClientSession,
): Promise<void> => {
  const existingQuery = Customer.exists({ userId: user._id });
  if (session) existingQuery.session(session);
  const existing = await existingQuery;
  if (existing) return;

  try {
    await new Customer({
      userId: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      source: "online",
      status: "active",
    }).save({ session });
  } catch (error) {
    // A concurrent first login may have created the same one-to-one profile.
    const profileQuery = Customer.exists({ userId: user._id });
    if (session) profileQuery.session(session);
    const profileNowExists = await profileQuery;
    if (!profileNowExists) throw error;
  }
};

interface CustomerAuthPolicy {
  emailPasswordEnabled: boolean;
  phonePasswordEnabled: boolean;
  googleEnabled: boolean;
}

const DEFAULT_CUSTOMER_AUTH_POLICY: CustomerAuthPolicy = {
  emailPasswordEnabled: true,
  phonePasswordEnabled: true,
  googleEnabled: true,
};

const getCustomerAuthPolicy = async (): Promise<CustomerAuthPolicy> => {
  const settings = await BusinessSettings.findOne({ singletonKey: "default" })
    .select("customerAuth")
    .lean();
  return settings?.customerAuth ?? DEFAULT_CUSTOMER_AUTH_POLICY;
};

const transactionIsUnsupported = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; codeName?: string; message?: string };
  return (
    candidate.code === 20 ||
    candidate.codeName === "IllegalOperation" ||
    Boolean(
      candidate.message?.includes(
        "Transaction numbers are only allowed on a replica set member",
      ),
    )
  );
};

const provisionCustomerWithCompensation = async (
  input: CustomerRegistrationInput,
): Promise<UserDocument> => {
  const user = await createLocalUser({ ...input, role: "customer" });
  try {
    await ensureCustomerProfile(user);
    return user;
  } catch (error) {
    try {
      await User.deleteOne({ _id: user._id });
    } catch (cleanupError) {
      logger.error("Customer registration compensation failed", cleanupError, {
        userId: user.id,
      });
    }
    throw error;
  }
};

export const createLocalUser = async (
  input: CreateLocalUserInput,
  options: CreateLocalUserOptions = {},
): Promise<UserDocument> => {
  const user = new User({
    name: input.name,
    email: input.email,
    phone: input.phone,
    password: input.password,
    role: input.role,
    authMethods: ["local"],
  });
  await user.save({ session: options.session });
  return user;
};

export class AuthService {
  constructor(
    private readonly verifier: GoogleIdentityVerifier = googleIdentityVerifier,
    private readonly tokens: TokenService = tokenService,
  ) {}

  private async createAuthResult(
    user: UserDocument,
    context: SessionContext,
    familyId?: string,
  ): Promise<AuthResult> {
    const tokens = await this.tokens.issue(user, context, familyId);
    return { user: toPublicUser(user), tokens };
  }

  async registerCustomer(
    input: CustomerRegistrationInput,
    context: SessionContext = {},
  ): Promise<AuthResult> {
    const policy = await getCustomerAuthPolicy();
    if (input.email && !policy.emailPasswordEnabled) {
      throw ApiError.forbidden(
        "Customer email/password registration is disabled",
        "EMAIL_AUTH_DISABLED",
      );
    }
    if (input.phone && !policy.phonePasswordEnabled) {
      throw ApiError.forbidden(
        "Customer mobile/password registration is disabled",
        "PHONE_AUTH_DISABLED",
      );
    }

    let user: UserDocument | undefined;
    try {
      await mongoose.connection.transaction(async (session) => {
        const createdUser = await createLocalUser(
          { ...input, role: "customer" },
          { session },
        );
        await ensureCustomerProfile(createdUser, session);
        user = createdUser;
      });
    } catch (error) {
      if (!transactionIsUnsupported(error)) throw error;
      user = await provisionCustomerWithCompensation(input);
    }

    if (!user) throw new Error("Customer registration did not create a user");
    return this.createAuthResult(user, context);
  }

  async login(
    input: LoginInput,
    context: SessionContext = {},
  ): Promise<AuthResult> {
    const identifier = normalizeIdentifier(input.identifier);
    const user = await User.findOne(identifier).select(USER_AUTH_SELECT);

    if (!user) {
      await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
      throw ApiError.unauthorized(
        "Invalid email/mobile number or password",
        "INVALID_CREDENTIALS",
      );
    }

    if (!user.authMethods.includes("local") || !user.password) {
      await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
      throw ApiError.unauthorized(
        "Invalid email/mobile number or password",
        "INVALID_CREDENTIALS",
      );
    }

    if (user.role === "customer") {
      const policy = await getCustomerAuthPolicy();
      if (
        (identifier.email && !policy.emailPasswordEnabled) ||
        (identifier.phone && !policy.phonePasswordEnabled)
      ) {
        throw ApiError.forbidden(
          "This customer sign-in method is disabled",
          "CUSTOMER_AUTH_METHOD_DISABLED",
        );
      }
    }

    if (user.isLocked()) {
      throw new ApiError(423, "Account is temporarily locked", {
        code: "ACCOUNT_LOCKED",
        details: {
          retryAfterSeconds: Math.max(
            Math.ceil(((user.lockedUntil?.getTime() ?? Date.now()) - Date.now()) / 1000),
            1,
          ),
        },
      });
    }

    const passwordMatches = await user.comparePassword(input.password);
    if (!passwordMatches) {
      await recordFailedLogin(user.id);

      throw ApiError.unauthorized(
        "Invalid email/mobile number or password",
        "INVALID_CREDENTIALS",
      );
    }

    if (!user.isActive) {
      throw ApiError.forbidden("This account is disabled", "ACCOUNT_DISABLED");
    }

    const lastLoginAt = new Date();
    const loginUpdate = await User.updateOne(
      { _id: user._id, isActive: true },
      {
        $set: { failedLoginAttempts: 0, lastLoginAt },
        $unset: { lockedUntil: 1 },
      },
    );
    if (loginUpdate.matchedCount !== 1) {
      throw ApiError.forbidden("This account is disabled", "ACCOUNT_DISABLED");
    }
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = lastLoginAt;

    if (user.role === "customer") await ensureCustomerProfile(user);
    return this.createAuthResult(user, context);
  }

  async loginWithGoogle(
    input: GoogleLoginInput,
    context: SessionContext = {},
  ): Promise<AuthResult> {
    const policy = await getCustomerAuthPolicy();
    if (!policy.googleEnabled) {
      throw ApiError.forbidden(
        "Customer Google sign-in is disabled",
        "GOOGLE_AUTH_DISABLED",
      );
    }

    const identity = await this.verifier.verify(input.idToken);

    let user = (await User.findOne({ googleId: identity.subject }).select(
      "+tokenVersion",
    )) as UserDocument | null;
    if (!user) {
      user = (await User.findOne({ email: identity.email }).select(
        "+tokenVersion",
      )) as UserDocument | null;
    }

    if (user) {
      if (user.role !== "customer") {
        throw ApiError.forbidden(
          "Google sign-in is available only for customer accounts",
          "GOOGLE_CUSTOMER_ONLY",
        );
      }
      if (!user.isActive) {
        throw ApiError.forbidden("This account is disabled", "ACCOUNT_DISABLED");
      }
      if (user.googleId && user.googleId !== identity.subject) {
        throw ApiError.conflict(
          "This email is already linked to another Google identity",
          undefined,
          "GOOGLE_IDENTITY_CONFLICT",
        );
      }

      user.googleId = identity.subject;
      user.authMethods = [...new Set([...user.authMethods, "google" as const])];
      user.emailVerifiedAt ??= new Date();
      user.avatarUrl ??= identity.avatarUrl;
      user.lastLoginAt = new Date();
      await user.save();
    } else {
      user = new User({
        name: identity.name,
        email: identity.email,
        googleId: identity.subject,
        authMethods: ["google"],
        role: "customer",
        avatarUrl: identity.avatarUrl,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      });
      await user.save();
    }

    await ensureCustomerProfile(user);
    return this.createAuthResult(user, context);
  }

  async refresh(
    refreshToken: string,
    context: SessionContext = {},
  ): Promise<AuthResult> {
    let consumed;
    try {
      consumed = await this.tokens.consumeRefreshToken(refreshToken);
    } catch (error) {
      if (error instanceof RefreshTokenReuseError) {
        const compromisedUser = await User.findById(error.userId).select(
          "+tokenVersion",
        );
        if (compromisedUser) {
          compromisedUser.tokenVersion += 1;
          await compromisedUser.save();
          await this.tokens.revokeAllUserSessions(compromisedUser.id);
        }
      }
      throw error;
    }
    const user = await User.findById(consumed.userId).select("+tokenVersion");

    if (
      !user ||
      !user.isActive ||
      user.tokenVersion !== consumed.tokenVersion ||
      user.role !== consumed.session.role
    ) {
      throw ApiError.unauthorized(
        "Refresh session is no longer valid",
        "REFRESH_SESSION_REVOKED",
      );
    }

    return this.createAuthResult(user, context, consumed.familyId);
  }

  async logout(sessionId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId);
  }

  async logoutAll(userId: string): Promise<void> {
    const user = await User.findById(userId).select("+tokenVersion");
    if (!user) {
      throw ApiError.unauthorized("Account no longer exists", "ACCOUNT_NOT_FOUND");
    }

    user.tokenVersion += 1;
    await user.save();
    await this.tokens.revokeAllUserSessions(user.id);
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    context: SessionContext = {},
  ): Promise<AuthResult> {
    const user = await User.findById(userId).select(USER_AUTH_SELECT);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized("Account is unavailable", "ACCOUNT_UNAVAILABLE");
    }

    const hasLocalPassword = user.authMethods.includes("local") && Boolean(user.password);
    if (hasLocalPassword) {
      if (
        !input.currentPassword ||
        !(await user.comparePassword(input.currentPassword))
      ) {
        throw ApiError.unauthorized(
          "Current password is incorrect",
          "INVALID_CURRENT_PASSWORD",
        );
      }
    } else if (user.role !== "customer" || !user.authMethods.includes("google")) {
      throw ApiError.badRequest(
        "This account cannot configure a password",
        undefined,
        "PASSWORD_NOT_AVAILABLE",
      );
    } else {
      const policy = await getCustomerAuthPolicy();
      if (!policy.emailPasswordEnabled) {
        throw ApiError.forbidden(
          "Customer email/password authentication is disabled",
          "EMAIL_AUTH_DISABLED",
        );
      }
    }

    user.password = input.newPassword;
    user.authMethods = [...new Set([...user.authMethods, "local" as const])];
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.tokenVersion += 1;
    await user.save();

    await this.tokens.revokeAllUserSessions(user.id);
    return this.createAuthResult(user, context);
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await User.findById(userId);
    if (!user || !user.isActive) {
      throw ApiError.unauthorized("Account is unavailable", "ACCOUNT_UNAVAILABLE");
    }
    return toPublicUser(user);
  }

  async requestPasswordReset(
    input: ForgotPasswordInput,
  ): Promise<{ devToken?: string }> {
    const identifier = normalizeIdentifier(input.identifier);
    const user = await User.findOne(identifier).select("+tokenVersion");
    if (!user || !user.isActive) return {};

    if (user.role === "customer") {
      const policy = await getCustomerAuthPolicy();
      if (
        (identifier.email && !policy.emailPasswordEnabled) ||
        (identifier.phone && !policy.phonePasswordEnabled)
      ) {
        return {};
      }
    }

    const issued = await actionTokenService.issue(
      "password-reset",
      {
        userId: user.id,
        tokenVersion: user.tokenVersion,
        subject: identifier.email ?? identifier.phone,
      },
      config.AUTH_PASSWORD_RESET_TTL_SECONDS,
    );

    try {
      await new OutboxEvent({
        aggregateType: "user",
        aggregateId: user._id,
        eventType: "auth.password_reset.requested",
        payload: {
          purpose: "password-reset",
          encryptedToken: issued.encryptedToken,
          expiresAt: issued.expiresAt,
          deliveryChannel: identifier.email ? "email" : "sms",
        },
      }).save();
    } catch (error) {
      await actionTokenService.revokeIssuedToken(
        "password-reset",
        user.id,
        issued.rawToken,
      );
      throw error;
    }

    return config.NODE_ENV === "production"
      ? {}
      : { devToken: issued.rawToken };
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const record = await actionTokenService.consume(
      "password-reset",
      input.token,
    );
    const user = await User.findById(record.userId).select(USER_AUTH_SELECT);
    if (
      !user ||
      !user.isActive ||
      user.tokenVersion !== record.tokenVersion
    ) {
      throw ApiError.badRequest(
        "Password-reset token is invalid or expired",
        undefined,
        "INVALID_PASSWORD_RESET_TOKEN",
      );
    }

    user.password = input.newPassword;
    user.authMethods = [...new Set([...user.authMethods, "local" as const])];
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.tokenVersion += 1;
    await user.save();
    await this.tokens.revokeAllUserSessions(user.id);
  }

  async requestEmailVerification(
    userId: string,
  ): Promise<{ alreadyVerified: boolean; devToken?: string }> {
    const user = await User.findById(userId).select("+tokenVersion");
    if (!user || !user.isActive) {
      throw ApiError.unauthorized("Account is unavailable", "ACCOUNT_UNAVAILABLE");
    }
    if (!user.email) {
      throw ApiError.badRequest(
        "This account does not have an email address",
        undefined,
        "EMAIL_NOT_CONFIGURED",
      );
    }
    if (user.emailVerifiedAt) return { alreadyVerified: true };

    const issued = await actionTokenService.issue(
      "email-verification",
      {
        userId: user.id,
        tokenVersion: user.tokenVersion,
        subject: user.email,
      },
      config.AUTH_EMAIL_VERIFICATION_TTL_SECONDS,
    );

    try {
      await new OutboxEvent({
        aggregateType: "user",
        aggregateId: user._id,
        eventType: "auth.email_verification.requested",
        payload: {
          purpose: "email-verification",
          encryptedToken: issued.encryptedToken,
          expiresAt: issued.expiresAt,
          deliveryChannel: "email",
        },
      }).save();
    } catch (error) {
      await actionTokenService.revokeIssuedToken(
        "email-verification",
        user.id,
        issued.rawToken,
      );
      throw error;
    }

    return {
      alreadyVerified: false,
      ...(config.NODE_ENV !== "production"
        ? { devToken: issued.rawToken }
        : {}),
    };
  }

  async confirmEmail(input: ConfirmEmailInput): Promise<PublicUser> {
    const record = await actionTokenService.consume(
      "email-verification",
      input.token,
    );
    const user = await User.findById(record.userId).select("+tokenVersion");
    if (
      !user ||
      !user.isActive ||
      !user.email ||
      user.email !== record.subject ||
      user.tokenVersion !== record.tokenVersion
    ) {
      throw ApiError.badRequest(
        "Email-verification token is invalid or expired",
        undefined,
        "INVALID_EMAIL_VERIFICATION_TOKEN",
      );
    }

    user.emailVerifiedAt ??= new Date();
    await user.save();
    return toPublicUser(user);
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<AuthSessionSummary[]> {
    return this.tokens.listUserSessions(userId, currentSessionId);
  }

  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    return this.tokens.revokeUserSession(userId, sessionId);
  }
}

export const authService = new AuthService();
