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
    expect(context.db.prepare("SELECT version FROM schema_migrations").pluck().all()).toEqual([1]);
    const readiness = checkDatabase(context.db, context.config);
    expect(readiness).toMatchObject({
      ok: true,
      pragmas: { journal_mode: "delete", synchronous: "normal", foreign_keys: true },
      integrity: { quick_check: "ok", foreign_key_violations: 0 },
      schema: {
        migration_version: 1,
        migration_name: "initial-normalized-schema",
        expected_migration_version: 1
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
});
