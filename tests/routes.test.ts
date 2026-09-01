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
          schema: { migration_version: 2, expected_migration_version: 2 }
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

  it("creates and revises complete recipes with ordered ingredients", async () => {
    const context = createTestContext("recipe-collection");
    contexts.push(context);
    const recipeInput = {
      name: "Roasted tomato soup",
      description: "A dependable weeknight soup.",
      cuisine_type: "American",
      meal_type: "dinner",
      prep_minutes: 15,
      cook_minutes: 40,
      servings: 6,
      difficulty_level: "easy",
      instructions: "1. Roast the tomatoes.\n2. Blend until smooth.",
      notes: "Double the garlic.",
      source_url: "https://example.com/tomato-soup",
      tags: ["weeknight", "soup"],
      is_favorite: true,
      rating: 4.5,
      nutrition: {
        calories: 220,
        protein_g: 7,
        carbs_g: 24,
        fat_g: 11,
        fiber_g: 5,
        sugar_g: 12,
        sodium_mg: 480
      },
      ingredients: [
        { name: "Roma tomatoes", quantity: 8, unit: "whole", notes: "halved" },
        { name: "Garlic", quantity: 4, unit: "cloves", notes: "peeled" }
      ]
    };
    const created = await request(context.app)
      .post("/api/recipes/collection")
      .set("Idempotency-Key", "create-soup")
      .send(recipeInput);

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: "Roasted tomato soup",
      total_minutes: 55,
      is_favorite: true,
      ingredient_count: 2,
      tags: ["weeknight", "soup"]
    });
    expect(created.body.data.ingredients.map((ingredient: { name: string; position: number }) => ({
      name: ingredient.name,
      position: ingredient.position
    }))).toEqual([
      { name: "Roma tomatoes", position: 0 },
      { name: "Garlic", position: 1 }
    ]);
    const firstIngredientId = created.body.data.ingredients[0].id as string;

    const id = created.body.data.id as string;
    const listed = await request(context.app).get("/api/recipes/collection");
    expect(listed.status).toBe(200);
    expect(listed.body.data[0]).toMatchObject({
      id,
      cuisine_type: "American",
      meal_type: "dinner",
      difficulty_level: "easy",
      ingredient_count: 2
    });

    const genericPatch = await request(context.app)
      .patch(`/api/recipes/recipes/${id}`)
      .set("Idempotency-Key", "describe-soup")
      .send({ description: "A revised weeknight soup." });
    expect(genericPatch.status).toBe(200);
    expect(genericPatch.body.data).toMatchObject({
      meal_type: "dinner",
      difficulty_level: "easy",
      is_favorite: 1
    });

    const updated = await request(context.app)
      .put(`/api/recipes/collection/${id}`)
      .set("Idempotency-Key", "revise-soup")
      .send({
        ...recipeInput,
        name: "Fire-roasted tomato soup",
        ingredients: [{ id: firstIngredientId, name: "Tomatoes", quantity: 8, unit: "whole", notes: "fire-roasted" }]
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ name: "Fire-roasted tomato soup", ingredient_count: 1 });
    expect(updated.body.data.ingredients[0]).toMatchObject({
      id: firstIngredientId,
      name: "Tomatoes",
      notes: "fire-roasted",
      position: 0
    });
    expect(context.db.prepare("SELECT COUNT(*) count FROM recipe_ingredients WHERE recipe_id=?").get(id))
      .toEqual({ count: 1 });

    const favorite = await request(context.app)
      .patch(`/api/recipes/collection/${id}/favorite`)
      .set("Idempotency-Key", "unfavorite-soup")
      .send({ is_favorite: false });
    expect(favorite.status).toBe(200);
    expect(favorite.body.data.is_favorite).toBe(false);

    const minimal = await request(context.app)
      .post("/api/recipes/collection")
      .set("Idempotency-Key", "create-toast")
      .send({ name: "Toast", ingredients: [] });
    expect(minimal.status).toBe(201);
    expect(minimal.body.data).toMatchObject({
      name: "Toast",
      meal_type: "dinner",
      difficulty_level: "medium",
      nutrition: null
    });
    const minimalId = minimal.body.data.id as string;
    const deleted = await request(context.app)
      .delete(`/api/recipes/collection/${minimalId}`)
      .set("Idempotency-Key", "delete-toast");
    const replayedDelete = await request(context.app)
      .delete(`/api/recipes/collection/${minimalId}`)
      .set("Idempotency-Key", "delete-toast");
    expect(deleted.status).toBe(204);
    expect(replayedDelete.status).toBe(204);
    expect(replayedDelete.headers["idempotency-replayed"]).toBe("true");

    const malformed = await request(context.app)
      .post("/api/recipes/recipes")
      .send({ name: "Unreadable", tags_json: "not-json" });
    expect(malformed.status).toBe(400);
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
