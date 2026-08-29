import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { migrations } from "./migrations.js";

export type HearthDatabase = Database.Database;

const expectedMigration = migrations.at(-1);
const schemaIdentity = `sha256:${createHash("sha256")
  .update(migrations.map((migration) => `${migration.version}:${migration.name}\n${migration.sql}`).join("\n"))
  .digest("hex")}`;

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

export function checkDatabase(
  db: HearthDatabase,
  config: Pick<AppConfig, "dbPath" | "production">
) {
  try {
    const integrity = db.pragma("quick_check", { simple: true }) as string;
    const migration = db.prepare(`
      SELECT version,name FROM schema_migrations ORDER BY version DESC LIMIT 1
    `).get() as { version: number; name: string } | undefined;
    const journalMode = db.pragma("journal_mode", { simple: true }) as string;
    const synchronousLevel = db.pragma("synchronous", { simple: true }) as number;
    const foreignKeys = db.pragma("foreign_keys", { simple: true }) as number;
    const foreignKeyViolations = (db.pragma("foreign_key_check") as unknown[]).length;
    const databasePath = db.name === ":memory:" ? db.name : path.resolve(db.name);
    const isPersistent = databasePath.startsWith("/home/data/");
    const sidecars = databasePath === ":memory:" ? undefined : {
      journal: fs.existsSync(`${databasePath}-journal`),
      wal: fs.existsSync(`${databasePath}-wal`),
      shm: fs.existsSync(`${databasePath}-shm`)
    };
    const expectedVersion = expectedMigration?.version ?? 0;
    const expectedName = expectedMigration?.name ?? null;
    const synchronous = ["off", "normal", "full", "extra"][synchronousLevel] ?? `unknown-${synchronousLevel}`;
    const ok = integrity === "ok"
      && migration?.version === expectedVersion
      && migration?.name === expectedName
      && journalMode.toLowerCase() === "delete"
      && foreignKeys === 1
      && foreignKeyViolations === 0
      && (!config.production || (isPersistent && synchronousLevel === 2))
      && databasePath === (config.dbPath === ":memory:" ? ":memory:" : path.resolve(config.dbPath));
    return {
      ok,
      authority: {
        engine: "sqlite",
        path: databasePath,
        persistent: isPersistent,
        file_size_bytes: databasePath === ":memory:" ? 0 : fs.statSync(databasePath).size,
        sidecars
      },
      pragmas: {
        journal_mode: journalMode.toLowerCase(),
        synchronous,
        foreign_keys: foreignKeys === 1
      },
      integrity: {
        quick_check: integrity,
        foreign_key_violations: foreignKeyViolations
      },
      schema: {
        identity: schemaIdentity,
        migration_version: migration?.version ?? 0,
        migration_name: migration?.name ?? null,
        expected_migration_version: expectedVersion,
        expected_migration_name: expectedName
      }
    };
  } catch (error) {
    return {
      ok: false,
      authority: { engine: "sqlite", path: db.name },
      detail: error instanceof Error ? error.message : "database check failed"
    };
  }
}
