import { createRemoteJWKSet, jwtVerify } from "jose";
import type { RequestHandler } from "express";
import type { AppConfig } from "./config.js";
import type { HearthDatabase } from "./db/database.js";
import { HttpError } from "./http.js";

const DEV_HOUSEHOLD_ID = "hsh_dev_hearth";
const DEV_USER_ID = "usr_dev_hearth";
const DEV_MEMBERSHIP_ID = "mem_dev_hearth";

export interface AuthContext {
  userId: string;
  householdId: string;
  role: "owner" | "member" | "viewer";
  subject: string;
}

interface MembershipRow {
  user_id: string;
  household_id: string;
  role: AuthContext["role"];
  oidc_subject: string | null;
}

export function seedDevelopmentIdentity(db: HearthDatabase, config: AppConfig): void {
  if (!config.devAuthEnabled || config.production) return;
  const now = new Date(0).toISOString();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO households(id,name,created_at,updated_at) VALUES(?,?,?,?)")
      .run(DEV_HOUSEHOLD_ID, "Development household", now, now);
    db.prepare("INSERT OR IGNORE INTO users(id,oidc_subject,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(DEV_USER_ID, "dev:local", config.DEV_AUTH_EMAIL, "Development member", now, now);
    db.prepare("INSERT OR IGNORE INTO household_memberships(id,household_id,user_id,role,created_at) VALUES(?,?,?,?,?)")
      .run(DEV_MEMBERSHIP_ID, DEV_HOUSEHOLD_ID, DEV_USER_ID, "owner", now);
  })();
}

export function createAuthMiddleware(db: HearthDatabase, config: AppConfig): RequestHandler {
  const jwks = config.oidcConfigured ? createRemoteJWKSet(new URL(config.OIDC_JWKS_URI!)) : undefined;
  return async (req, _res, next) => {
    try {
      let subject: string;
      if (config.devAuthEnabled && !config.production) {
        subject = "dev:local";
      } else {
        if (!jwks || !config.OIDC_ISSUER || !config.OIDC_AUDIENCE) {
          throw new HttpError(503, "authentication_not_configured", "Authentication is not configured");
        }
        const authorization = req.header("authorization");
        if (!authorization?.startsWith("Bearer ")) {
          throw new HttpError(401, "authentication_required", "Bearer token required");
        }
        const verified = await jwtVerify(authorization.slice(7), jwks, {
          issuer: config.OIDC_ISSUER,
          audience: config.OIDC_AUDIENCE
        });
        subject = verified.payload.sub ?? "";
        if (!subject) throw new HttpError(401, "invalid_token", "Token has no subject");
      }

      const requestedHousehold = req.header("x-household-id");
      const row = db.prepare(`
        SELECT u.id user_id, m.household_id, m.role, u.oidc_subject
        FROM users u JOIN household_memberships m ON m.user_id=u.id
        WHERE u.oidc_subject=? AND (? IS NULL OR m.household_id=?)
        ORDER BY m.created_at LIMIT 1
      `).get(subject, requestedHousehold ?? null, requestedHousehold ?? null) as MembershipRow | undefined;
      if (!row) throw new HttpError(403, "membership_required", "No authorized household membership");
      req.auth = { userId: row.user_id, householdId: row.household_id, role: row.role, subject };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireMutationRole: RequestHandler = (req, _res, next) => {
  if (req.auth?.role === "viewer") return next(new HttpError(403, "insufficient_role", "Write access required"));
  next();
};
