import type { UserRole } from "../models/auth/User.js";

export interface AuthContext {
  userId: string;
  role: UserRole;
  sessionId: string;
  tokenVersion: number;
}

export interface PublicUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  authMethods: Array<"local" | "google">;
  avatarUrl?: string;
  isActive: boolean;
  emailVerifiedAt?: string;
  phoneVerifiedAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthResult {
  user: PublicUser;
  tokens: AuthTokens;
}

export interface AuthSessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  userAgent?: string;
}
