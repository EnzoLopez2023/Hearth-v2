import { Router } from "express";
import { z } from "zod";
import { requireMutationRole } from "../auth.js";
import type { HearthDatabase } from "../db/database.js";
import { HttpError } from "../http.js";
import { nutritionSchema, tagsSchema } from "./recipe-data.js";
import { stableId, writeAudit } from "./shared.js";

const optionalText = z.string().trim().max(10_000).nullable().optional();
const ingredientSchema = z.strictObject({
  id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(500),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: optionalText
});
const recipeInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(500),
  description: optionalText,
  cuisine_type: z.string().trim().max(200).nullable().optional(),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "dessert", "appetizer"]).default("dinner"),
  prep_minutes: z.number().int().nonnegative().nullable().optional(),
  cook_minutes: z.number().int().nonnegative().nullable().optional(),
  servings: z.number().int().positive().nullable().optional(),
  difficulty_level: z.enum(["easy", "medium", "hard"]).default("medium"),
  instructions: optionalText,
  notes: optionalText,
  source_url: z.string().trim().url().max(2_048).nullable().optional(),
  tags: tagsSchema.default([]),
  is_favorite: z.boolean().default(false),
  rating: z.number().min(0).max(5).nullable().optional(),
  nutrition: nutritionSchema.nullable().optional(),
  ingredients: z.array(ingredientSchema).max(250).default([])
});
const favoriteSchema = z.strictObject({ is_favorite: z.boolean() });

interface RecipeRow {
  id: string;
  name: string;
  description: string | null;
  cuisine_type: string | null;
  meal_type: string;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  servings: number | null;
  difficulty_level: string;
  instructions: string | null;
  notes: string | null;
  source_url: string | null;
  is_favorite: number;
  rating: number | null;
  parsed_by_ai: number;
  ai_suggestions: string | null;
  tags_json: string | null;
  nutrition_json: string | null;
  created_at: string;
  updated_at: string;
  ingredient_count: number;
  primary_blob_id: string | null;
  primary_alt_text: string | null;
}

interface IngredientRow {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  position: number;
}

interface ImageRow {
  id: string;
  blob_id: string;
  alt_text: string | null;
  position: number;
}

function invalidStoredData(id: string, field: string): HttpError {
  return new HttpError(500, "invalid_recipe_data", `Recipe ${id} contains invalid ${field} data`);
}

function storedTags(row: RecipeRow): string[] {
  if (!row.tags_json) return [];
  try {
    const parsed = tagsSchema.safeParse(JSON.parse(row.tags_json));
    if (parsed.success) return parsed.data;
  } catch {
    // The structured error below identifies the affected recipe and field.
  }
  throw invalidStoredData(row.id, "tag");
}

function storedNutrition(row: RecipeRow): z.infer<typeof nutritionSchema> | null {
  if (!row.nutrition_json) return null;
  try {
    const value: unknown = JSON.parse(row.nutrition_json);
    if (value === null) return null;
    const parsed = nutritionSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // The structured error below identifies the affected recipe and field.
  }
  throw invalidStoredData(row.id, "nutrition");
}

function recipeSelect(): string {
  return `
    SELECT r.*,
      (SELECT COUNT(*) FROM recipe_ingredients i
        WHERE i.recipe_id=r.id AND i.household_id=r.household_id) AS ingredient_count,
      (SELECT image.blob_id FROM recipe_images image
        WHERE image.recipe_id=r.id AND image.household_id=r.household_id
        ORDER BY image.position,image.created_at LIMIT 1) AS primary_blob_id,
      (SELECT image.alt_text FROM recipe_images image
        WHERE image.recipe_id=r.id AND image.household_id=r.household_id
        ORDER BY image.position,image.created_at LIMIT 1) AS primary_alt_text
    FROM recipes r
  `;
}

function serializeRecipe(row: RecipeRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cuisine_type: row.cuisine_type,
    meal_type: row.meal_type,
    prep_minutes: row.prep_minutes,
    cook_minutes: row.cook_minutes,
    total_minutes: row.total_minutes,
    servings: row.servings,
    difficulty_level: row.difficulty_level,
    instructions: row.instructions,
    notes: row.notes,
    source_url: row.source_url,
    is_favorite: row.is_favorite === 1,
    rating: row.rating,
    parsed_by_ai: row.parsed_by_ai === 1,
    ai_suggestions: row.ai_suggestions,
    tags: storedTags(row),
    nutrition: storedNutrition(row),
    ingredient_count: row.ingredient_count,
    primary_image: row.primary_blob_id
      ? {
          blob_id: row.primary_blob_id,
          alt_text: row.primary_alt_text,
          url: `/api/blobs/${row.primary_blob_id}`
        }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function findRecipe(db: HearthDatabase, householdId: string, id: string): RecipeRow {
  const row = db.prepare(`${recipeSelect()} WHERE r.id=? AND r.household_id=?`)
    .get(id, householdId) as RecipeRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "Recipe not found");
  return row;
}

function recipeDetail(db: HearthDatabase, householdId: string, id: string) {
  const recipe = serializeRecipe(findRecipe(db, householdId, id));
  const ingredients = db.prepare(`
    SELECT id,name,quantity,unit,notes,position
    FROM recipe_ingredients
    WHERE recipe_id=? AND household_id=?
    ORDER BY position,created_at
  `).all(id, householdId) as IngredientRow[];
  const images = db.prepare(`
    SELECT id,blob_id,alt_text,position
    FROM recipe_images
    WHERE recipe_id=? AND household_id=?
    ORDER BY position,created_at
  `).all(id, householdId) as ImageRow[];
  return {
    ...recipe,
    ingredients,
    images: images.map((image) => ({ ...image, url: `/api/blobs/${image.blob_id}` }))
  };
}

function parseRecipe(body: unknown): z.infer<typeof recipeInputSchema> {
  const parsed = recipeInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, "validation_error", "Recipe details are invalid", parsed.error.flatten());
  }
  return parsed.data;
}

function insertIngredients(
  db: HearthDatabase,
  householdId: string,
  recipeId: string,
  ingredients: z.infer<typeof ingredientSchema>[],
  now: string
): void {
  const insert = db.prepare(`
    INSERT INTO recipe_ingredients(
      id,household_id,recipe_id,name,quantity,unit,notes,position,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `);
  ingredients.forEach((ingredient, position) => {
    insert.run(
      stableId("rin"),
      householdId,
      recipeId,
      ingredient.name,
      ingredient.quantity ?? null,
      ingredient.unit ?? null,
      ingredient.notes ?? null,
      position,
      now,
      now
    );
  });
}

function reconcileIngredients(
  db: HearthDatabase,
  householdId: string,
  recipeId: string,
  ingredients: z.infer<typeof ingredientSchema>[],
  now: string
): void {
  const existing = new Set(
    db.prepare(`
      SELECT id FROM recipe_ingredients WHERE recipe_id=? AND household_id=?
    `).pluck().all(recipeId, householdId) as string[]
  );
  const retained = new Set<string>();
  const update = db.prepare(`
    UPDATE recipe_ingredients
    SET name=?,quantity=?,unit=?,notes=?,position=?,updated_at=?
    WHERE id=? AND recipe_id=? AND household_id=?
  `);
  const insert = db.prepare(`
    INSERT INTO recipe_ingredients(
      id,household_id,recipe_id,name,quantity,unit,notes,position,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `);

  ingredients.forEach((ingredient, position) => {
    if (ingredient.id) {
      if (!existing.has(ingredient.id)) {
        throw new HttpError(422, "invalid_reference", "Recipe ingredient does not belong to this recipe");
      }
      if (retained.has(ingredient.id)) {
        throw new HttpError(400, "validation_error", "A recipe ingredient cannot appear more than once");
      }
      update.run(
        ingredient.name,
        ingredient.quantity ?? null,
        ingredient.unit ?? null,
        ingredient.notes ?? null,
        position,
        now,
        ingredient.id,
        recipeId,
        householdId
      );
      retained.add(ingredient.id);
      return;
    }
    insert.run(
      stableId("rin"),
      householdId,
      recipeId,
      ingredient.name,
      ingredient.quantity ?? null,
      ingredient.unit ?? null,
      ingredient.notes ?? null,
      position,
      now,
      now
    );
  });

  const remove = db.prepare(`
    DELETE FROM recipe_ingredients WHERE id=? AND recipe_id=? AND household_id=?
  `);
  for (const id of existing) {
    if (!retained.has(id)) remove.run(id, recipeId, householdId);
  }
}

function recipeValues(data: z.infer<typeof recipeInputSchema>) {
  const totalMinutes = data.prep_minutes === null && data.cook_minutes === null
    ? null
    : (data.prep_minutes ?? 0) + (data.cook_minutes ?? 0);
  return [
    data.name,
    data.description ?? null,
    data.cuisine_type ?? null,
    data.meal_type,
    data.prep_minutes ?? null,
    data.cook_minutes ?? null,
    totalMinutes,
    data.servings ?? null,
    data.difficulty_level,
    data.instructions ?? null,
    data.notes ?? null,
    data.source_url ?? null,
    data.is_favorite ? 1 : 0,
    data.rating ?? null,
    JSON.stringify(data.tags),
    data.nutrition === undefined
      ? undefined
      : data.nutrition === null
        ? null
        : JSON.stringify(data.nutrition)
  ] as const;
}

export function createRecipeCollectionRouter(db: HearthDatabase): Router {
  const router = Router();

  router.get("/collection", (req, res) => {
    const rows = db.prepare(`
      ${recipeSelect()}
      WHERE r.household_id=?
      ORDER BY r.created_at DESC
    `).all(req.auth!.householdId) as RecipeRow[];
    const imported = Boolean(db.prepare(`
      SELECT 1 FROM legacy_imports WHERE household_id=? LIMIT 1
    `).get(req.auth!.householdId));
    res.json({ data: rows.map(serializeRecipe), meta: { legacy_imported: imported } });
  });

  router.get("/collection/:id", (req, res) => {
    res.json({ data: recipeDetail(db, req.auth!.householdId, String(req.params.id)) });
  });

  router.post("/collection", requireMutationRole, (req, res) => {
    const data = parseRecipe(req.body);
    const auth = req.auth!;
    const id = stableId("rcp");
    const now = new Date().toISOString();
    const values = recipeValues(data);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO recipes(
          id,household_id,name,description,cuisine_type,meal_type,prep_minutes,cook_minutes,
          total_minutes,servings,difficulty_level,instructions,notes,source_url,is_favorite,
          rating,tags_json,nutrition_json,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, auth.householdId, ...values.slice(0, 15), values[15] ?? null, now, now);
      insertIngredients(db, auth.householdId, id, data.ingredients, now);
      writeAudit(db, auth, req.requestId, "create", "recipes", id);
    })();
    res.status(201).json({ data: recipeDetail(db, auth.householdId, id) });
  });

  router.put("/collection/:id", requireMutationRole, (req, res) => {
    const data = parseRecipe(req.body);
    const auth = req.auth!;
    const id = String(req.params.id);
    findRecipe(db, auth.householdId, id);
    const now = new Date().toISOString();
    const values = recipeValues(data);
    db.transaction(() => {
      db.prepare(`
        UPDATE recipes SET
          name=?,description=?,cuisine_type=?,meal_type=?,prep_minutes=?,cook_minutes=?,
          total_minutes=?,servings=?,difficulty_level=?,instructions=?,notes=?,source_url=?,
          is_favorite=?,rating=?,tags_json=?,
          nutrition_json=CASE WHEN ? IS NULL THEN nutrition_json ELSE ? END,
          updated_at=?
        WHERE id=? AND household_id=?
      `).run(
        ...values.slice(0, 15),
        values[15] === undefined ? null : 1,
        values[15] ?? null,
        now,
        id,
        auth.householdId
      );
      reconcileIngredients(db, auth.householdId, id, data.ingredients, now);
      writeAudit(db, auth, req.requestId, "update", "recipes", id);
    })();
    res.json({ data: recipeDetail(db, auth.householdId, id) });
  });

  router.patch("/collection/:id/favorite", requireMutationRole, (req, res) => {
    const parsed = favoriteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "validation_error", "Favorite state is invalid", parsed.error.flatten());
    }
    const auth = req.auth!;
    const id = String(req.params.id);
    const result = db.transaction(() => {
      const updated = db.prepare(`
        UPDATE recipes SET is_favorite=?,updated_at=? WHERE id=? AND household_id=?
      `).run(parsed.data.is_favorite ? 1 : 0, new Date().toISOString(), id, auth.householdId);
      if (updated.changes) writeAudit(db, auth, req.requestId, "update", "recipes", id);
      return updated;
    })();
    if (!result.changes) throw new HttpError(404, "not_found", "Recipe not found");
    res.json({ data: serializeRecipe(findRecipe(db, auth.householdId, id)) });
  });

  router.delete("/collection/:id", requireMutationRole, (req, res) => {
    const auth = req.auth!;
    const id = String(req.params.id);
    const result = db.transaction(() => {
      const deleted = db.prepare("DELETE FROM recipes WHERE id=? AND household_id=?")
        .run(id, auth.householdId);
      if (deleted.changes) writeAudit(db, auth, req.requestId, "delete", "recipes", id);
      return deleted;
    })();
    if (!result.changes) throw new HttpError(404, "not_found", "Recipe not found");
    res.status(204).send();
  });

  return router;
}
