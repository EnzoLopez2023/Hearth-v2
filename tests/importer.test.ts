import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, testRoot } from "./test-utils.js";
import { importLegacyDatabase } from "../src/server/legacy/importer.js";

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

describe("legacy importer", () => {
  it("imports once, preserves ids, reconciles hashes, and makes an exact rerun a no-op", () => {
    const context = createTestContext("legacy-target");
    contexts.push(context);
    const sourcePath = sourceFile("legacy-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE recipes(id INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT,created_at TEXT,updated_at TEXT);
      INSERT INTO recipes VALUES(42,'Soup','A dependable soup','2020-01-01','2020-01-02');
      CREATE TABLE home_items(id INTEGER PRIMARY KEY,name TEXT NOT NULL,qr_identifier TEXT,created_at TEXT,updated_at TEXT);
      INSERT INTO home_items VALUES(77,'Boiler','HEARTH-LEGACY-77','2020-01-01','2020-01-02');
    `);
    source.close();

    const options = {
      target: context.db, sourcePath, householdId: "hsh_dev_hearth", sourceNamespace: "fixture:v1"
    };
    const first = importLegacyDatabase(options);
    const second = importLegacyDatabase(options);
    expect(first.status).toBe("imported");
    expect(second.status).toBe("no_op");
    expect(second.importId).toBe(first.importId);
    expect(context.db.prepare("SELECT id,name FROM recipes").get()).toEqual({ id: "42", name: "Soup" });
    expect(context.db.prepare("SELECT source_id,target_id FROM legacy_identifier_map WHERE source_table='home_items'").get())
      .toEqual({ source_id: "77", target_id: "77" });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_reconciliation WHERE import_id=?").get(first.importId))
      .toEqual({ count: 2 });

    const changed = new Database(sourcePath);
    changed.prepare("UPDATE recipes SET description='Changed' WHERE id=42").run();
    changed.close();
    expect(() => importLegacyDatabase(options)).toThrow(/source differs/);
  });

  it("rolls back every row when any mapping is invalid", () => {
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
    expect(() => importLegacyDatabase({
      target: context.db, sourcePath, householdId: "hsh_dev_hearth", sourceNamespace: "fixture:invalid"
    })).toThrow(/missing required mapped field name/);
    expect(context.db.prepare("SELECT COUNT(*) count FROM recipes").get()).toEqual({ count: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_imports").get()).toEqual({ count: 0 });
  });

  it("refuses attachment-bearing sources instead of reconciling a partial import", () => {
    const context = createTestContext("legacy-attachments");
    contexts.push(context);
    const sourcePath = sourceFile("attachment-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE pool_reports(
        id INTEGER PRIMARY KEY,
        test_date TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_data BLOB NOT NULL
      );
    `);
    source.prepare("INSERT INTO pool_reports VALUES(?,?,?,?)")
      .run(9, "2026-08-28T14:30:00.000Z", "synthetic-report.pdf", Buffer.from("synthetic fixture"));
    source.close();

    expect(() => importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments"
    })).toThrow(/durable blob adapter/);
    expect(context.db.prepare("SELECT COUNT(*) count FROM pool_reports").get()).toEqual({ count: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_imports").get()).toEqual({ count: 0 });
  });
});
