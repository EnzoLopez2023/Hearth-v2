import { z } from "zod";
import { nutritionSchema, storedJsonSchema, tagsSchema } from "./recipe-data.js";

export interface ReferenceDefinition {
  field: string;
  table: string;
  nullable?: boolean;
}

export interface ResourceDefinition {
  path: string;
  table: string;
  idPrefix: string;
  create: z.ZodType<Record<string, unknown>>;
  update: z.ZodType<Record<string, unknown>>;
  references?: ReferenceDefinition[];
  orderBy?: string;
}

const text = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(10_000).nullable().optional();
const id = z.string().trim().min(1).max(200);
const nullableId = id.nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableDate = date.nullable().optional();
const nonnegative = z.number().nonnegative();
const positive = z.number().positive();
const zeroOrOne = z.union([z.literal(0), z.literal(1)]);

function resource(
  path: string,
  table: string,
  idPrefix: string,
  schema: z.ZodRawShape,
  options: Pick<ResourceDefinition, "references" | "orderBy"> = {}
): ResourceDefinition {
  const create = z.strictObject(schema);
  const updateShape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema) as Array<[string, z.ZodType]>) {
    const withoutDefault = field instanceof z.ZodDefault ? field.removeDefault() : field;
    updateShape[key] = z.optional(withoutDefault);
  }
  return { path, table, idPrefix, create, update: z.strictObject(updateShape), ...options };
}

export const domainResources: Record<string, ResourceDefinition[]> = {
  maintenance: [
    resource("items", "home_items", "hit", {
      name: text, description: optionalText, manufacturer: optionalText, model: optionalText,
      serial_number: optionalText, purchased_on: nullableDate, installed_on: nullableDate,
      qr_identifier: z.string().trim().max(200).nullable().optional(), location: optionalText
    }, { orderBy: "name COLLATE NOCASE" }),
    resource("tasks", "maintenance_tasks", "mtk", {
      home_item_id: nullableId, title: text, description: optionalText, due_on: nullableDate,
      recurrence_days: z.number().int().positive().nullable().optional(),
      status: z.enum(["open", "in_progress", "completed", "cancelled"]).default("open"),
      completed_at: z.string().datetime().nullable().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal")
    }, { references: [{ field: "home_item_id", table: "home_items", nullable: true }], orderBy: "due_on IS NULL, due_on" }),
    resource("warranties", "warranties", "wty", {
      home_item_id: id, provider: optionalText, policy_number: optionalText, starts_on: nullableDate,
      expires_on: nullableDate, notes: optionalText, blob_id: nullableId
    }, { references: [{ field: "home_item_id", table: "home_items" }, { field: "blob_id", table: "blob_metadata", nullable: true }], orderBy: "expires_on IS NULL, expires_on" }),
    resource("photos", "maintenance_photos", "mph", {
      task_id: nullableId, home_item_id: nullableId, blob_id: id, caption: optionalText
    }, { references: [{ field: "task_id", table: "maintenance_tasks", nullable: true }, { field: "home_item_id", table: "home_items", nullable: true }, { field: "blob_id", table: "blob_metadata" }] }),
    resource("costs", "maintenance_costs", "mco", {
      task_id: nullableId, home_item_id: nullableId, amount_cents: z.number().int(),
      currency: z.string().length(3).default("USD"), incurred_on: date, vendor: optionalText, notes: optionalText
    }, { references: [{ field: "task_id", table: "maintenance_tasks", nullable: true }, { field: "home_item_id", table: "home_items", nullable: true }], orderBy: "incurred_on DESC" }),
    resource("insights", "ai_insights", "ain", {
      domain: z.enum(["maintenance", "inventory", "yard", "garden", "pool", "recipes"]),
      subject_id: nullableId, provider: text, kind: text, content: text,
      status: z.enum(["active", "dismissed", "acted_on"]).default("active")
    }, { orderBy: "created_at DESC" })
  ],
  inventory: [
    resource("categories", "inventory_categories", "ict", { name: text, description: optionalText }, { orderBy: "name COLLATE NOCASE" }),
    resource("locations", "inventory_locations", "ilo", {
      name: text, description: optionalText, qr_identifier: z.string().trim().max(200).nullable().optional()
    }, { orderBy: "name COLLATE NOCASE" }),
    resource("sub-locations", "inventory_sub_locations", "isl", {
      location_id: id, name: text, description: optionalText
    }, { references: [{ field: "location_id", table: "inventory_locations" }], orderBy: "name COLLATE NOCASE" }),
    resource("items", "inventory_items", "iit", {
      category_id: nullableId, location_id: nullableId, sub_location_id: nullableId,
      name: text, description: optionalText, quantity: nonnegative.default(1),
      low_quantity: nonnegative.nullable().optional(), unit: z.string().trim().max(50).nullable().optional(),
      expires_on: nullableDate, purchased_on: nullableDate, value_cents: z.number().int().nonnegative().nullable().optional(),
      qr_identifier: z.string().trim().max(200).nullable().optional()
    }, {
      references: [
        { field: "category_id", table: "inventory_categories", nullable: true },
        { field: "location_id", table: "inventory_locations", nullable: true },
        { field: "sub_location_id", table: "inventory_sub_locations", nullable: true }
      ],
      orderBy: "name COLLATE NOCASE"
    }),
    resource("images", "inventory_item_images", "iim", {
      inventory_item_id: id, blob_id: id, alt_text: optionalText, position: z.number().int().nonnegative().default(0)
    }, { references: [{ field: "inventory_item_id", table: "inventory_items" }, { field: "blob_id", table: "blob_metadata" }] })
  ],
  yard: [
    resource("locations", "yard_location", "ylo", {
      name: text, description: optionalText, latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(), area_sq_ft: positive.nullable().optional(),
      qr_identifier: z.string().trim().max(200).nullable().optional()
    }, { orderBy: "name COLLATE NOCASE" }),
    resource("tasks", "yard_tasks", "ytk", {
      yard_location_id: nullableId, title: text, due_on: nullableDate,
      status: z.enum(["open", "in_progress", "completed", "cancelled"]).default("open"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), notes: optionalText
    }, { references: [{ field: "yard_location_id", table: "yard_location", nullable: true }], orderBy: "due_on IS NULL, due_on" }),
    resource("weather", "weather_daily", "wdy", {
      observed_on: date, latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
      high_c: z.number().nullable().optional(), low_c: z.number().nullable().optional(),
      precipitation_mm: nonnegative.nullable().optional(), conditions: optionalText, provider: text
    }, { orderBy: "observed_on DESC" })
  ],
  garden: [
    resource("fields", "garden_fields", "gfd", {
      yard_location_id: nullableId, name: text, description: optionalText
    }, { references: [{ field: "yard_location_id", table: "yard_location", nullable: true }], orderBy: "name COLLATE NOCASE" }),
    resource("vegetables", "garden_vegetables", "gvg", {
      name: text, variety: optionalText, days_to_maturity: z.number().int().positive().nullable().optional(), notes: optionalText
    }, { orderBy: "name COLLATE NOCASE" }),
    resource("beds", "garden_beds", "gbd", {
      field_id: nullableId, name: text, description: optionalText, area_sq_ft: positive.nullable().optional(),
      qr_identifier: z.string().trim().max(200).nullable().optional()
    }, { references: [{ field: "field_id", table: "garden_fields", nullable: true }], orderBy: "name COLLATE NOCASE" }),
    resource("plantings", "garden_plantings", "gpl", {
      bed_id: id, vegetable_id: nullableId, planted_on: nullableDate, expected_harvest_on: nullableDate,
      quantity: z.number().int().positive().nullable().optional(),
      status: z.enum(["planned", "planted", "harvesting", "finished", "failed"]).default("planned"), notes: optionalText
    }, { references: [{ field: "bed_id", table: "garden_beds" }, { field: "vegetable_id", table: "garden_vegetables", nullable: true }], orderBy: "planted_on DESC" }),
    resource("tasks", "garden_tasks", "gtk", {
      bed_id: nullableId, planting_id: nullableId, title: text, due_on: nullableDate,
      status: z.enum(["open", "in_progress", "completed", "cancelled"]).default("open"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), notes: optionalText
    }, { references: [{ field: "bed_id", table: "garden_beds", nullable: true }, { field: "planting_id", table: "garden_plantings", nullable: true }], orderBy: "due_on IS NULL, due_on" }),
    resource("harvests", "garden_harvests", "ghv", {
      planting_id: id, harvested_on: date, quantity: positive, unit: text, notes: optionalText
    }, { references: [{ field: "planting_id", table: "garden_plantings" }], orderBy: "harvested_on DESC" }),
    resource("settings", "garden_settings", "gst", {
      setting_key: z.string().trim().min(1).max(100), value_json: z.string().max(100_000)
    }, { orderBy: "setting_key" }),
    resource("shopping", "garden_shopping", "gsh", {
      planting_id: nullableId, name: text, quantity: positive.nullable().optional(),
      unit: z.string().trim().max(50).nullable().optional(),
      status: z.enum(["needed", "purchased", "cancelled"]).default("needed"), notes: optionalText
    }, { references: [{ field: "planting_id", table: "garden_plantings", nullable: true }], orderBy: "status, name COLLATE NOCASE" })
  ],
  pool: [
    resource("reports", "pool_reports", "prp", {
      observed_at: z.string().datetime(), status: z.enum(["draft", "complete", "reviewed"]).default("draft"),
      notes: optionalText, water_temperature: z.number().nullable().optional()
    }, { orderBy: "observed_at DESC" }),
    resource("readings", "pool_report_results", "prs", {
      report_id: id, metric: text, value: z.number(), unit: text,
      min_target: z.number().nullable().optional(), max_target: z.number().nullable().optional()
    }, { references: [{ field: "report_id", table: "pool_reports" }] }),
    resource("recommendations", "pool_report_recommendations", "prc", {
      report_id: id, title: text, detail: optionalText,
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      status: z.enum(["open", "completed", "dismissed"]).default("open")
    }, { references: [{ field: "report_id", table: "pool_reports" }], orderBy: "status, created_at DESC" }),
    resource("chemicals", "pool_chemicals", "pch", {
      name: text, quantity: nonnegative.default(0), unit: text, low_quantity: nonnegative.nullable().optional(),
      expires_on: nullableDate, notes: optionalText
    }, { orderBy: "name COLLATE NOCASE" }),
    resource("insights", "pool_insights", "pin", {
      report_id: nullableId, provider: text, content: text,
      status: z.enum(["active", "dismissed"]).default("active")
    }, { references: [{ field: "report_id", table: "pool_reports", nullable: true }], orderBy: "created_at DESC" })
  ],
  recipes: [
    resource("recipes", "recipes", "rcp", {
      name: text, description: optionalText, instructions: optionalText,
      servings: z.number().int().positive().nullable().optional(),
      prep_minutes: z.number().int().nonnegative().nullable().optional(),
      cook_minutes: z.number().int().nonnegative().nullable().optional(),
      total_minutes: z.number().int().nonnegative().nullable().optional(),
      cuisine_type: optionalText,
      meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "dessert", "appetizer"]).default("dinner"),
      difficulty_level: z.enum(["easy", "medium", "hard"]).default("medium"),
      notes: optionalText, source_url: z.string().trim().url().max(2_048).nullable().optional(),
      is_favorite: zeroOrOne.default(0), rating: z.number().min(0).max(5).nullable().optional(),
      parsed_by_ai: zeroOrOne.default(0), ai_suggestions: optionalText,
      tags_json: storedJsonSchema(tagsSchema, 10_000).nullable().optional(),
      nutrition_json: storedJsonSchema(nutritionSchema, 100_000).nullable().optional()
    }, { orderBy: "created_at DESC" }),
    resource("ingredients", "recipe_ingredients", "rin", {
      recipe_id: id, name: text, quantity: positive.nullable().optional(),
      unit: z.string().trim().max(50).nullable().optional(), notes: optionalText,
      position: z.number().int().nonnegative().default(0)
    }, { references: [{ field: "recipe_id", table: "recipes" }], orderBy: "recipe_id, position" }),
    resource("images", "recipe_images", "rim", {
      recipe_id: id, blob_id: id, alt_text: optionalText, position: z.number().int().nonnegative().default(0)
    }, { references: [{ field: "recipe_id", table: "recipes" }, { field: "blob_id", table: "blob_metadata" }] })
  ]
};
