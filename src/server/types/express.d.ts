import type { AuthContext } from "../auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId: string;
    }
  }
}

export {};
