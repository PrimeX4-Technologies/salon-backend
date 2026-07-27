import { OAuth2Client } from "google-auth-library";

import { config } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface GoogleIdentityVerifier {
  verify(idToken: string): Promise<VerifiedGoogleIdentity>;
}

export class GoogleOAuthIdentityVerifier implements GoogleIdentityVerifier {
  private readonly client: OAuth2Client;

  constructor(
    private readonly clientId: string | undefined = config.GOOGLE_CLIENT_ID,
    client = new OAuth2Client(),
  ) {
    this.client = client;
  }

  async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (!this.clientId) {
      throw new ApiError(503, "Google sign-in is not configured", {
        code: "GOOGLE_AUTH_NOT_CONFIGURED",
      });
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();

      if (
        !payload?.sub ||
        !payload.email ||
        payload.email_verified !== true
      ) {
        throw ApiError.unauthorized(
          "Google did not provide a verified email identity",
          "INVALID_GOOGLE_IDENTITY",
        );
      }

      return {
        subject: payload.sub,
        email: payload.email.trim().toLowerCase(),
        name: payload.name?.trim() || payload.email.split("@")[0],
        ...(payload.picture ? { avatarUrl: payload.picture } : {}),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, "Google identity token is invalid or expired", {
        code: "INVALID_GOOGLE_TOKEN",
        cause: error,
      });
    }
  }
}

export const googleIdentityVerifier = new GoogleOAuthIdentityVerifier();
