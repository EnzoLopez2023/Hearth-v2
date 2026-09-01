import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/server/config.js";
import { openDatabase } from "../src/server/db/database.js";
import { seedDevelopmentIdentity } from "../src/server/auth.js";
import { createProviders } from "../src/server/providers/index.js";
import type { AiProvider, BlobProvider } from "../src/server/providers/index.js";
import { createApp } from "../src/server/app.js";

export const testRoot = path.resolve(".test-artifacts");

export function createTestContext(name: string, options: { ai?: AiProvider; blob?: BlobProvider } = {}) {
  fs.mkdirSync(testRoot, { recursive: true });
  const dbPath = path.join(testRoot, `${name}-${process.pid}-${crypto.randomUUID()}.db`);
  const config = loadConfig({
    NODE_ENV: "test",
    DEV_AUTH_ENABLED: "true",
    DEV_AUTH_EMAIL: "test@hearth.local",
    DB_PATH: dbPath,
    BUILD_VERSION: "test",
    SOURCE_SHA: "test-sha",
    BUILD_TIME: "2026-01-01T00:00:00Z"
  });
  const db = openDatabase(config);
  seedDevelopmentIdentity(db, config);
  const providers = createProviders(config);
  const configuredProviders = {
    ...providers,
    ...(options.ai ? { ai: options.ai } : {}),
    ...(options.blob ? { blob: options.blob } : {})
  };
  return {
    db,
    dbPath,
    config,
    app: createApp(config, db, configuredProviders),
    close() {
      db.close();
      fs.rmSync(dbPath, { force: true });
    }
  };
}
