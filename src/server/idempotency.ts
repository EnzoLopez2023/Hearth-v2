import { createHash, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { HearthDatabase } from "./db/database.js";
import { HttpError } from "./http.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function idempotency(db: HearthDatabase): RequestHandler {
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const key = req.header("idempotency-key");
    if (!key) return next();
    if (key.length > 200) return next(new HttpError(400, "invalid_idempotency_key", "Idempotency-Key is too long"));
    const auth = req.auth!;
    const requestPath = req.originalUrl.split("?", 1)[0]!;
    const requestHash = createHash("sha256").update(canonical(req.body)).digest("hex");
    const existing = db.prepare(`
      SELECT request_hash,status_code,response_json FROM idempotency_records
      WHERE household_id=? AND user_id=? AND method=? AND path=? AND idempotency_key=?
    `).get(auth.householdId, auth.userId, req.method, requestPath, key) as
      { request_hash: string; status_code: number; response_json: string } | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        return next(new HttpError(409, "idempotency_conflict", "Idempotency-Key was used with a different request"));
      }
      res.setHeader("idempotency-replayed", "true");
      return res.status(existing.status_code).json(JSON.parse(existing.response_json));
    }
    const original = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        db.prepare(`
          INSERT INTO idempotency_records
          (id,household_id,user_id,method,path,idempotency_key,request_hash,status_code,response_json,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `).run(randomUUID(), auth.householdId, auth.userId, req.method, requestPath, key, requestHash,
          res.statusCode, JSON.stringify(body), new Date().toISOString());
      }
      return original(body);
    }) as typeof res.json;
    next();
  };
}
