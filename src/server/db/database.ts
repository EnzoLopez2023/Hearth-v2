import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { migrations } from "./migrations.js";

export type HearthDatabase = Database.Database;

export function openDatabase(config: Pick<AppConfig, "dbPath" | "production">): HearthDatabase {
  if (config.dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
  }
  const db = new Database(config.dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = DELETE");
  db.pragma(`synchronous = ${config.production ? "FULL" : "NORMAL"}`);
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: HearthDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version)
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}

export function checkDatabase(db: HearthDatabase): { ok: boolean; migrationVersion: number; detail?: string } {
  try {
    const integrity = db.pragma("quick_check", { simple: true }) as string;
    const row = db.prepare("SELECT COALESCE(MAX(version),0) version FROM schema_migrations").get() as { version: number };
    const expected = migrations.at(-1)?.version ?? 0;
    return {
      ok: integrity === "ok" && row.version === expected,
      migrationVersion: row.version,
      ...(integrity === "ok" ? {} : { detail: integrity })
    };
  } catch (error) {
    return { ok: false, migrationVersion: 0, detail: error instanceof Error ? error.message : "database check failed" };
  }
}
