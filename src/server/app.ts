import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { HearthDatabase } from "./db/database.js";
import { checkDatabase } from "./db/database.js";
import { createAuthMiddleware } from "./auth.js";
import { errorHandler, HttpError, notFound, requestContext } from "./http.js";
import { idempotency } from "./idempotency.js";
import { createDashboardRouter } from "./domains/dashboard.js";
import { createDomainRouter } from "./domains/router.js";
import type { createProviders } from "./providers/index.js";
import { createBlobRouter } from "./providers/blob-router.js";

type Providers = ReturnType<typeof createProviders>;

export function createApp(config: AppConfig, db: HearthDatabase, providers: Providers) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(express.json({ limit: "1mb" }));

  const version = Object.freeze({
    version: config.BUILD_VERSION,
    source_sha: config.SOURCE_SHA,
    build_time: config.BUILD_TIME,
    build_id: config.BUILD_ID
  });
  const instanceId = process.env.WEBSITE_INSTANCE_ID ?? `pid-${process.pid}`;
  const operational = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.set("cache-control", "no-store");
    next();
  };
  app.get("/auth-config.json", operational, (_req, res) => res.json({
    enabled: config.entraConfigured,
    authority: config.ENTRA_TENANT_ID
      ? `https://login.microsoftonline.com/${config.ENTRA_TENANT_ID}`
      : null,
    client_id: config.ENTRA_CLIENT_ID ?? null,
    scope: config.ENTRA_API_SCOPE ?? null
  }));
  app.get("/version.json", operational, (_req, res) => res.json(version));
  app.get("/api/version", operational, (_req, res) => res.json(version));
  app.get("/api/live", operational, (_req, res) => res.json({
    status: "live",
    ...version,
    instance_id: instanceId
  }));
  app.get("/api/ready", (_req, res) => {
    res.set("cache-control", "no-store");
    const database = checkDatabase(db, config);
    res.status(database.ok ? 200 : 503).json({
      status: database.ok ? "ready" : "not_ready",
      ...version,
      instance_id: instanceId,
      checks: { database },
      optional_providers: providers.configuration
    });
  });

  app.use("/api", createAuthMiddleware(db, config));
  app.use("/api", idempotency(db));
  app.use("/api/blobs", createBlobRouter(db, providers.blob));
  app.use("/api/dashboard", createDashboardRouter(db));
  for (const domain of ["maintenance", "inventory", "yard", "garden", "pool", "recipes"] as const) {
    app.use(`/api/${domain}`, createDomainRouter(db, domain));
  }
  app.get("/api/identifiers/:identifier", (req, res) => {
    const household = req.auth!.householdId;
    const identifier = req.params.identifier;
    const candidates = [
      ["home_items", "maintenance/items"],
      ["inventory_locations", "inventory/locations"],
      ["inventory_items", "inventory/items"],
      ["yard_location", "yard/locations"],
      ["garden_beds", "garden/beds"]
    ] as const;
    for (const [table, route] of candidates) {
      const row = db.prepare(`SELECT id FROM ${table} WHERE household_id=? AND qr_identifier=?`).get(household, identifier) as { id: string } | undefined;
      if (row) return res.json({ data: { identifier, table, id: row.id, api_path: `/api/${route}/${row.id}` } });
    }
    const legacy = db.prepare(`
      SELECT target_table,target_id FROM legacy_identifier_map
      WHERE household_id=? AND source_id=? ORDER BY created_at LIMIT 1
    `).get(household, identifier);
    if (legacy) return res.json({ data: { identifier, legacy } });
    throw new HttpError(404, "identifier_not_found", "Identifier not found");
  });

  const clientRoot = path.resolve("dist/client");
  if (fs.existsSync(clientRoot)) {
    app.use(express.static(clientRoot, { index: false }));
    app.get("*splat", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(clientRoot, "index.html"));
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
