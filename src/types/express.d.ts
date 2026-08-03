import type { UserDocument } from "../models/auth/User.js";
import type { AuthContext } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      user?: UserDocument;
      rawBody?: Buffer;
    }
  }
}

export {};
