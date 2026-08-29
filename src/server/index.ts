import "dotenv/config";
import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { seedDevelopmentIdentity } from "./auth.js";
import { createProviders } from "./providers/index.js";
import { createApp } from "./app.js";

const config = loadConfig();
const db = openDatabase(config);
seedDevelopmentIdentity(db, config);
const providers = createProviders(config);
const app = createApp(config, db, providers);
const server = createServer(app);

server.listen(config.PORT, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "server_started",
    port: config.PORT,
    environment: config.NODE_ENV,
    version: config.BUILD_VERSION,
    oidc_configured: config.oidcConfigured,
    providers: providers.configuration
  }));
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", event: "shutdown_started", signal }));
  server.close((error) => {
    try { db.close(); } finally {
      if (error) {
        console.error(JSON.stringify({ level: "error", event: "shutdown_failed", message: error.message }));
        process.exitCode = 1;
      }
    }
  });
  setTimeout(() => {
    console.error(JSON.stringify({ level: "error", event: "shutdown_timeout" }));
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
