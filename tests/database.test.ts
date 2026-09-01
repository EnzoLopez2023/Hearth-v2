import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { checkDatabase } from "../src/server/db/database.js";
import { createTestContext, testRoot } from "./test-utils.js";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("database foundation", () => {
  it("applies migrations and connection safety pragmas", () => {
    const context = createTestContext("pragmas");
    contexts.push(context);
    expect(context.db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(context.db.pragma("journal_mode", { simple: true })).toBe("delete");
    expect(context.db.pragma("synchronous", { simple: true })).toBe(1);
    expect(context.db.prepare("SELECT version FROM schema_migrations").pluck().all()).toEqual([1, 2, 3, 4]);
    const readiness = checkDatabase(context.db, context.config);
    expect(readiness).toMatchObject({
      ok: true,
      pragmas: { journal_mode: "delete", synchronous: "normal", foreign_keys: true },
      integrity: { quick_check: "ok", foreign_key_violations: 0 },
      schema: {
        migration_version: 4,
        migration_name: "restore-owned-domain-fields",
        expected_migration_version: 4
      }
    });
  });

  it("contains every owned normalized legacy concept", () => {
    const context = createTestContext("schema");
    contexts.push(context);
    const names = new Set((context.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").pluck().all()) as string[]);
    const expected = `
      recipes recipe_ingredients recipe_images home_items maintenance_tasks warranties maintenance_photos
      maintenance_costs ai_insights inventory_categories inventory_locations inventory_sub_locations inventory_items
      inventory_item_images pool_reports pool_report_results pool_report_recommendations pool_chemicals pool_insights
      weather_daily yard_location garden_fields garden_vegetables garden_beds garden_plantings garden_tasks
      garden_harvests garden_settings garden_shopping
    `.trim().split(/\s+/);
    for (const table of expected) expect(names.has(table), table).toBe(true);
  });

  it("preserves the complete legacy recipe record", () => {
    const context = createTestContext("recipe-schema");
    contexts.push(context);
    const recipeColumns = new Set(
      (context.db.prepare("PRAGMA table_info(recipes)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    const ingredientColumns = new Set(
      (context.db.prepare("PRAGMA table_info(recipe_ingredients)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    for (const column of [
      "cuisine_type", "meal_type", "total_minutes", "difficulty_level", "notes", "source_url",
      "is_favorite", "rating", "parsed_by_ai", "ai_suggestions", "nutrition_json"
    ]) {
      expect(recipeColumns.has(column), column).toBe(true);
    }
    expect(ingredientColumns.has("notes")).toBe(true);
  });

  it("contains the complete owned maintenance, inventory, garden, and pool fields", () => {
    const context = createTestContext("complete-domain-schema");
    contexts.push(context);
    const expected: Record<string, string[]> = {
      home_items: ["category", "estimated_lifespan_years", "replacement_cost_cents"],
      maintenance_tasks: ["task_type", "scheduled_on", "estimated_duration_hours", "actual_duration_hours", "next_due_on", "assigned_to", "notes", "ai_generated"],
      warranties: ["warranty_type", "claim_process", "contact_info", "blob_id", "is_active", "ai_analyzed", "ai_summary"],
      maintenance_photos: ["blob_id", "photo_category", "taken_at", "ai_analyzed", "ai_description", "ai_tags_json"],
      maintenance_costs: ["cost_type", "description", "tax_cents", "warranty_covered", "ai_categorized", "receipt_blob_id"],
      inventory_items: ["maintenance_item_id", "condition", "status", "brand", "model", "serial_number", "barcode", "sku", "purchased_from", "purchase_price_cents", "product_url", "notes", "ai_identified"],
      yard_location: ["zip", "profile_json", "profile_at"],
      garden_vegetables: ["slug", "latin", "family", "sow_start_month", "harvest_end_month", "spacing_in", "sun", "water", "days_to_germinate", "frost_tolerance", "companions_json", "antagonists_json"],
      garden_beds: ["shape", "width_in", "height_in", "pos_x", "pos_y", "rotation_deg", "sun_exposure", "soil_notes"],
      garden_plantings: ["variety", "season_year", "pos_x", "pos_y", "sown_at", "transplanted_at", "first_harvest_at", "removed_at"],
      garden_tasks: ["field_id", "kind", "done_at", "source"],
      garden_harvests: ["weight_oz", "qty_count", "quality"],
      garden_settings: ["season_year", "active_field_id", "units"],
      garden_shopping: ["season_year", "vegetable_id", "quantity_text"],
      pool_reports: ["test_date_text", "report_format", "store_name", "analyst_name", "test_id", "pool_volume_gal", "pool_type", "water_temperature_f", "filter_type", "test_kind", "custom_ideals", "summary", "handwritten_notes", "blob_id", "file_hash", "raw_parse_json", "parse_model", "parse_status", "parse_error", "verified_at"],
      pool_report_results: ["parameter_label", "value_text", "ideal_text", "status", "position"],
      pool_report_recommendations: ["source", "product", "instruction", "quantity_text", "target", "timing", "warnings", "completed_at", "position"],
      pool_chemicals: ["category", "product_name", "brand", "active_ingredient", "active_percent", "available_chlorine_percent", "net_weight_lbs"],
      pool_insights: ["payload_json", "water_health", "report_count", "model", "generated_at"]
    };
    for (const [table, columns] of Object.entries(expected)) {
      const actual = new Set(
        (context.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
      );
      for (const column of columns) expect(actual.has(column), `${table}.${column}`).toBe(true);
    }
  });
});
