import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { HearthDatabase } from "../db/database.js";
import { requireMutationRole } from "../auth.js";
import { asyncRoute, HttpError } from "../http.js";
import type { BlobProvider } from "./index.js";

const uploadSchema = z.strictObject({
  file_name: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(1).max(200),
  data_base64: z.string().max(14_000_000)
});

export function createBlobRouter(db: HearthDatabase, provider: BlobProvider): Router {
  const router = Router();
  router.post("/", requireMutationRole, asyncRoute(async (req, res) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "validation_error", "Request body is invalid", parsed.error.flatten());
    const bytes = Buffer.from(parsed.data.data_base64, "base64");
    if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== parsed.data.data_base64.replace(/=+$/, "")) {
      throw new HttpError(400, "invalid_base64", "data_base64 is invalid");
    }
    const id = `blb_${randomUUID().replaceAll("-", "")}`;
    const key = `${req.auth!.householdId}/${id}`;
    const stored = await provider.put(key, bytes);
    if (stored.status === "not_configured") throw new HttpError(503, "blob_not_configured", stored.message);
    if (stored.status === "error") throw new HttpError(502, "blob_provider_error", stored.message);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO blob_metadata(id,household_id,blob_key,provider,content_type,byte_size,sha256,original_name,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.auth!.householdId, key, provider.name, parsed.data.content_type, stored.value.byteSize,
      stored.value.sha256, parsed.data.file_name, now, now);
    res.status(201).json({ data: db.prepare("SELECT * FROM blob_metadata WHERE id=?").get(id) });
  }));
  router.get("/:id", asyncRoute(async (req, res) => {
    const row = db.prepare("SELECT * FROM blob_metadata WHERE id=? AND household_id=?")
      .get(req.params.id, req.auth!.householdId) as { blob_key: string; content_type: string; provider: string } | undefined;
    if (!row) throw new HttpError(404, "not_found", "Blob not found");
    if (row.provider !== provider.name) throw new HttpError(503, "blob_provider_mismatch", "The blob's provider is not configured");
    const result = await provider.get(row.blob_key);
    if (result.status === "not_configured") throw new HttpError(503, "blob_not_configured", result.message);
    if (result.status === "error") throw new HttpError(502, "blob_provider_error", result.message);
    res.type(row.content_type).send(Buffer.from(result.value));
  }));
  router.delete("/:id", requireMutationRole, asyncRoute(async (req, res) => {
    const row = db.prepare("SELECT blob_key,provider FROM blob_metadata WHERE id=? AND household_id=?")
      .get(req.params.id, req.auth!.householdId) as { blob_key: string; provider: string } | undefined;
    if (!row) throw new HttpError(404, "not_found", "Blob not found");
    if (row.provider !== provider.name) throw new HttpError(503, "blob_provider_mismatch", "The blob's provider is not configured");
    const referenced = db.prepare(`
      SELECT 1 FROM recipe_images WHERE blob_id=?
      UNION ALL SELECT 1 FROM maintenance_photos WHERE blob_id=?
      UNION ALL SELECT 1 FROM inventory_item_images WHERE blob_id=?
      UNION ALL SELECT 1 FROM warranties WHERE blob_id=?
      LIMIT 1
    `).get(req.params.id, req.params.id, req.params.id, req.params.id);
    if (referenced) throw new HttpError(409, "blob_in_use", "Blob is referenced by a record");
    const result = await provider.delete(row.blob_key);
    if (result.status === "not_configured") throw new HttpError(503, "blob_not_configured", result.message);
    if (result.status === "error") throw new HttpError(502, "blob_provider_error", result.message);
    db.prepare("DELETE FROM blob_metadata WHERE id=? AND household_id=?").run(req.params.id, req.auth!.householdId);
    res.status(204).send();
  }));
  return router;
}
