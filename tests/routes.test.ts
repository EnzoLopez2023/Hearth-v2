import fs from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, testRoot } from "./test-utils.js";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("household domain routes", () => {
  it("reports immutable build and durable database readiness details", async () => {
    const context = createTestContext("readiness");
    contexts.push(context);
    const live = await request(context.app).get("/api/live");
    const ready = await request(context.app).get("/api/ready");
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: "live", source_sha: "test-sha", build_id: "local" });
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      status: "ready",
      source_sha: "test-sha",
      checks: {
        database: {
          ok: true,
          pragmas: { journal_mode: "delete", foreign_keys: true },
          schema: { migration_version: 1, expected_migration_version: 1 }
        }
      }
    });
  });

  it("returns structured validation errors", async () => {
    const context = createTestContext("validation");
    contexts.push(context);
    const response = await request(context.app).post("/api/recipes/recipes").send({ name: "" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
    expect(response.body.error.request_id).toBeTruthy();
  });

  it("enforces ownership for records and parent references", async () => {
    const context = createTestContext("ownership");
    contexts.push(context);
    const now = new Date().toISOString();
    context.db.prepare("INSERT INTO households(id,name,created_at,updated_at) VALUES(?,?,?,?)")
      .run("hsh_other", "Other", now, now);
    context.db.prepare("INSERT INTO inventory_locations(id,household_id,name,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run("ilo_other", "hsh_other", "Other location", now, now);

    const hidden = await request(context.app).get("/api/inventory/locations/ilo_other");
    expect(hidden.status).toBe(404);
    const invalidReference = await request(context.app).post("/api/inventory/sub-locations")
      .send({ location_id: "ilo_other", name: "Shelf" });
    expect(invalidReference.status).toBe(422);
    expect(invalidReference.body.error.code).toBe("invalid_reference");
  });

  it("preserves and resolves physical QR identifiers", async () => {
    const context = createTestContext("qr");
    contexts.push(context);
    const created = await request(context.app).post("/api/maintenance/items")
      .set("Idempotency-Key", "create-furnace")
      .send({ name: "Furnace", qr_identifier: "HEARTH-QR-00042" });
    expect(created.status).toBe(201);
    expect(created.body.data.qr_identifier).toBe("HEARTH-QR-00042");
    const replay = await request(context.app).post("/api/maintenance/items")
      .set("Idempotency-Key", "create-furnace")
      .send({ name: "Furnace", qr_identifier: "HEARTH-QR-00042" });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");

    const resolved = await request(context.app).get("/api/identifiers/HEARTH-QR-00042");
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.id).toBe(created.body.data.id);
    expect(context.db.prepare("SELECT COUNT(*) count FROM home_items").get()).toEqual({ count: 1 });
  });

  it("reports a truthful empty dashboard", async () => {
    const context = createTestContext("dashboard");
    contexts.push(context);
    const response = await request(context.app).get("/api/dashboard");
    expect(response.status).toBe(200);
    expect(response.body.data.first_run).toBe(true);
    expect(response.body.data.attention.maintenance).toEqual([]);
  });
});
