import { randomUUID } from "node:crypto";
import type { HearthDatabase } from "../db/database.js";

export function stableId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function writeAudit(
  db: HearthDatabase,
  auth: NonNullable<Express.Request["auth"]>,
  requestId: string,
  action: string,
  table: string,
  entityId: string
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_log(id,household_id,user_id,action,entity_table,entity_id,request_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(stableId("aud"), auth.householdId, auth.userId, action, table, entityId, requestId, now, now);
}
