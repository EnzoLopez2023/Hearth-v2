import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, testRoot } from "./test-utils.js";
import { importLegacyDatabase } from "../src/server/legacy/importer.js";
import type { BlobProvider } from "../src/server/providers/index.js";

const contexts: ReturnType<typeof createTestContext>[] = [];
const sources: string[] = [];
afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const source of sources.splice(0)) fs.rmSync(source, { force: true });
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function sourceFile(name: string): string {
  fs.mkdirSync(testRoot, { recursive: true });
  const file = path.join(testRoot, `${name}-${crypto.randomUUID()}.db`);
  sources.push(file);
  return file;
}

class MemoryBlobProvider implements BlobProvider {
  readonly name = "memory";
  readonly blobs = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array) {
    this.blobs.set(key, Uint8Array.from(bytes));
    return {
      status: "ok" as const,
      value: {
        key,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      }
    };
  }

  async create(key: string, bytes: Uint8Array) {
    const created = !this.blobs.has(key);
    if (created) this.blobs.set(key, Uint8Array.from(bytes));
    return {
      status: "ok" as const,
      value: {
        key,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        created
      }
    };
  }

  async get(key: string) {
    const bytes = this.blobs.get(key);
    return bytes
      ? { status: "ok" as const, value: Uint8Array.from(bytes) }
      : { status: "error" as const, provider: this.name, message: "Blob not found" };
  }

  async delete(key: string) {
    this.blobs.delete(key);
    return { status: "ok" as const, value: undefined };
  }
}

describe("legacy importer", () => {
  it("imports once, preserves ids, reconciles hashes, and makes an exact rerun a no-op", async () => {
    const context = createTestContext("legacy-target");
    contexts.push(context);
    const sourcePath = sourceFile("legacy-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE recipes(
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        cuisine_type TEXT,
        meal_type TEXT,
        prep_time_minutes INTEGER,
        cook_time_minutes INTEGER,
        total_time_minutes INTEGER,
        servings INTEGER,
        difficulty_level TEXT,
        instructions TEXT,
        notes TEXT,
        source_url TEXT,
        is_favorite INTEGER,
        rating REAL,
        dietary_tags TEXT,
        parsed_by_ai INTEGER,
        ai_suggestions TEXT,
        nutrition TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO recipes VALUES(
        42,'Soup','A dependable soup','American','dinner',10,35,0,6,'easy',
        'Roast, blend, and serve.','Double the garlic.','https://example.com/soup',1,4.5,
        '["comfort","soup"]',1,'Use garden tomatoes.',
        '{"calories":220,"protein_g":7,"carbs_g":24,"fat_g":11,"fiber_g":5,"sugar_g":12,"sodium_mg":480}',
        '2020-01-01','2020-01-02'
      );
      CREATE TABLE recipe_ingredients(
        id INTEGER PRIMARY KEY,
        recipe_id INTEGER,
        ingredient_name TEXT,
        quantity REAL,
        unit TEXT,
        notes TEXT,
        position INTEGER
      );
      INSERT INTO recipe_ingredients VALUES(8,42,'Tomatoes',8,'whole','halved',0);
      CREATE TABLE home_items(id INTEGER PRIMARY KEY,name TEXT NOT NULL,qr_identifier TEXT,created_at TEXT,updated_at TEXT);
      INSERT INTO home_items VALUES(77,'Boiler','HEARTH-LEGACY-77','2020-01-01','2020-01-02');
    `);
    source.close();

    const options = {
      target: context.db, sourcePath, householdId: "hsh_dev_hearth", sourceNamespace: "fixture:v1"
    };
    const first = await importLegacyDatabase(options);
    context.db.prepare(`
      UPDATE recipes SET cuisine_type=NULL,meal_type='dinner',total_minutes=NULL,
        difficulty_level='medium',notes=NULL,source_url=NULL,is_favorite=0,rating=NULL,
        parsed_by_ai=0,ai_suggestions=NULL,nutrition_json=NULL
    `).run();
    context.db.prepare("UPDATE recipe_ingredients SET notes=NULL").run();
    context.db.prepare("UPDATE legacy_imports SET mapping_version=1 WHERE id=?").run(first.importId);
    const upgraded = await importLegacyDatabase(options);
    const second = await importLegacyDatabase(options);
    expect(first.status).toBe("imported");
    expect(upgraded.status).toBe("upgraded");
    expect(upgraded.importId).toBe(first.importId);
    expect(second.status).toBe("no_op");
    expect(second.importId).toBe(first.importId);
    expect(context.db.prepare("SELECT mapping_version FROM legacy_imports WHERE id=?").pluck().get(first.importId)).toBe(2);
    expect(context.db.prepare(`
      SELECT id,name,cuisine_type,meal_type,total_minutes,difficulty_level,notes,source_url,
        is_favorite,rating,parsed_by_ai,ai_suggestions,tags_json
      FROM recipes
    `).get()).toEqual({
      id: "42",
      name: "Soup",
      cuisine_type: "American",
      meal_type: "dinner",
      total_minutes: null,
      difficulty_level: "easy",
      notes: "Double the garlic.",
      source_url: "https://example.com/soup",
      is_favorite: 1,
      rating: 4.5,
      parsed_by_ai: 1,
      ai_suggestions: "Use garden tomatoes.",
      tags_json: '["comfort","soup"]'
    });
    expect(JSON.parse(context.db.prepare("SELECT nutrition_json FROM recipes").pluck().get() as string)).toEqual({
      calories: 220,
      protein_g: 7,
      carbs_g: 24,
      fat_g: 11,
      fiber_g: 5,
      sugar_g: 12,
      sodium_mg: 480
    });
    expect(context.db.prepare("SELECT name,quantity,unit,notes,position FROM recipe_ingredients").get())
      .toEqual({ name: "Tomatoes", quantity: 8, unit: "whole", notes: "halved", position: 0 });
    expect(context.db.prepare("SELECT source_id,target_id FROM legacy_identifier_map WHERE source_table='home_items'").get())
      .toEqual({ source_id: "77", target_id: "77" });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_reconciliation WHERE import_id=?").get(first.importId))
      .toEqual({ count: 3 });

    const changed = new Database(sourcePath);
    changed.prepare("UPDATE recipes SET description='Changed' WHERE id=42").run();
    changed.close();
    await expect(importLegacyDatabase(options)).rejects.toThrow(/source differs/);
  });

  it("rolls back every row when any mapping is invalid", async () => {
    const context = createTestContext("legacy-rollback");
    contexts.push(context);
    const sourcePath = sourceFile("invalid-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE recipes(id INTEGER PRIMARY KEY,title TEXT NOT NULL);
      INSERT INTO recipes VALUES(1,'Valid recipe');
      CREATE TABLE recipe_ingredients(id INTEGER PRIMARY KEY,recipe_id INTEGER,ingredient_name TEXT);
      INSERT INTO recipe_ingredients VALUES(2,1,NULL);
    `);
    source.close();
    await expect(importLegacyDatabase({
      target: context.db, sourcePath, householdId: "hsh_dev_hearth", sourceNamespace: "fixture:invalid"
    })).rejects.toThrow(/missing required mapped field name/);
    expect(context.db.prepare("SELECT COUNT(*) count FROM recipes").get()).toEqual({ count: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_imports").get()).toEqual({ count: 0 });
  });

  it("imports embedded attachments through a durable provider and reconciles their links", async () => {
    const context = createTestContext("legacy-attachments");
    contexts.push(context);
    const sourcePath = sourceFile("attachment-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE recipes(
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        images TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO recipes VALUES(4,'Soup','["/api/recipe-images/8"]','2026-08-28','2026-08-28');
      CREATE TABLE recipe_images(
        id INTEGER PRIMARY KEY,
        recipe_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_data BLOB NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        uploaded_at TEXT
      );
      CREATE TABLE pool_reports(
        id INTEGER PRIMARY KEY,
        test_date TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_data BLOB NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL
      );
      CREATE TABLE pool_report_recommendations(
        id INTEGER PRIMARY KEY,
        report_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        instruction TEXT NOT NULL,
        completed_at TEXT
      );
      INSERT INTO pool_report_recommendations VALUES
        (10,9,'computer','Printed dose',NULL),
        (11,9,'handwritten','Technician dose',NULL);
    `);
    const image = Buffer.from("synthetic image");
    source.prepare("INSERT INTO recipe_images VALUES(?,?,?,?,?,?,?)")
      .run(8, 4, "soup.jpg", image, "image/jpeg", image.length, "2026-08-28");
    const report = Buffer.from("synthetic fixture");
    source.prepare("INSERT INTO pool_reports VALUES(?,?,?,?,?,?)")
      .run(9, "2026-08-28T14:30:00.000Z", "synthetic-report.pdf", report, "application/pdf", report.length);
    source.close();

    const provider = new MemoryBlobProvider();
    const result = await importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments",
      blobProvider: provider
    });
    expect(result.attachments).toEqual({
      count: 2,
      bytes: image.length + report.length,
      provider: "memory"
    });
    expect(provider.blobs.size).toBe(2);
    expect(context.db.prepare("SELECT recipe_id,position FROM recipe_images WHERE id='8'").get())
      .toEqual({ recipe_id: "4", position: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM blob_metadata").get()).toEqual({ count: 2 });
    expect(context.db.prepare(`
      SELECT target_table,identifier_kind FROM legacy_identifier_map
      WHERE source_table='pool_reports.file_data' AND source_id='9'
    `).get()).toEqual({ target_table: "blob_metadata", identifier_kind: "attachment" });
    expect(context.db.prepare(`
      SELECT id,status FROM pool_report_recommendations ORDER BY id
    `).all()).toEqual([
      { id: "10", status: "dismissed" },
      { id: "11", status: "open" }
    ]);
    expect((await importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments",
      blobProvider: provider
    })).status).toBe("no_op");

    provider.blobs.clear();
    await expect(importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments",
      blobProvider: provider
    })).rejects.toThrow(/stored blob is unavailable/);
  });

  it("refuses embedded attachments without a durable provider and leaves no partial rows", async () => {
    const context = createTestContext("legacy-attachment-refusal");
    contexts.push(context);
    const sourcePath = sourceFile("attachment-refusal-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE pool_reports(
        id INTEGER PRIMARY KEY,
        test_date TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_data BLOB NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL
      );
    `);
    const report = Buffer.from("synthetic fixture");
    source.prepare("INSERT INTO pool_reports VALUES(?,?,?,?,?,?)")
      .run(9, "2026-08-28T14:30:00.000Z", "synthetic-report.pdf", report, "application/pdf", report.length);
    source.close();

    await expect(importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachment-refusal"
    })).rejects.toThrow(/no durable blob provider/);
    expect(context.db.prepare("SELECT COUNT(*) count FROM pool_reports").get()).toEqual({ count: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_imports").get()).toEqual({ count: 0 });
  });
});
