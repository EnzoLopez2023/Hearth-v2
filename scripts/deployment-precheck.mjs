#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const READY_TIMEOUT_MS = 10_000;
const AZURE_TIMEOUT_MS = 30_000;
const REQUIRED_SETTING_NAMES = Object.freeze([
  "AZURE_STORAGE_ACCOUNT_URL",
  "BLOB_PROVIDER",
  "ENTRA_API_SCOPE",
  "ENTRA_CLIENT_ID",
  "ENTRA_TENANT_ID",
  "NODE_ENV",
  "OIDC_AUDIENCE",
  "OIDC_ISSUER",
  "OIDC_JWKS_URI"
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} is missing or malformed`);
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} is missing or malformed`);
  return value;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label} is missing or malformed`);
  return value;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const equals = token.indexOf("=");
    const key = token.slice(2, equals === -1 ? undefined : equals);
    const value = equals === -1 ? argv[++index] : token.slice(equals + 1);
    if (!key || value === undefined || value === "") throw new Error(`missing value for --${key}`);
    options[key] = value;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value === "") throw new Error(`missing --${name}`);
  return value;
}

function readinessParts(payload) {
  const root = requireObject(payload, "readiness response");
  const checks = requireObject(root.checks, "readiness checks");
  const database = requireObject(checks.database, "database readiness check");
  requireBoolean(database.ok, "database readiness status");
  return { root, database };
}

export function parseCandidateMigration(source) {
  const migrations = [];
  const pattern = /\bversion:\s*(\d+),\s*[\r\n]+\s*name:\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    migrations.push({ version: Number.parseInt(match[1], 10), name: match[2] });
  }
  if (migrations.length === 0) throw new Error("candidate migration manifest has no migrations");
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index].version <= migrations[index - 1].version) {
      throw new Error("candidate migration versions are not strictly increasing");
    }
  }
  return migrations.at(-1);
}

export function evaluateMigration(payload, candidate) {
  const { root, database } = readinessParts(payload);
  const schema = requireObject(database.schema, "database schema readiness");
  const currentVersion = requireInteger(schema.migration_version, "production migration version");
  const productionExpected = requireInteger(
    schema.expected_migration_version,
    "production expected migration version"
  );
  const compatible = currentVersion <= candidate.version;
  const ready = root.status === "ready" && database.ok === true;
  const ok = compatible && ready;
  return {
    schema_version: "1.0",
    check: "migration-compatibility-precheck",
    ok,
    detail: ok
      ? "The candidate migration sequence can advance the current production schema."
      : compatible
        ? "Production database readiness is not healthy enough to establish migration compatibility."
        : "Production is ahead of the candidate migration sequence; activation would be a schema downgrade.",
    production: {
      status: root.status,
      source_sha: typeof root.source_sha === "string" ? root.source_sha : null,
      migration_version: currentVersion,
      expected_migration_version: productionExpected
    },
    candidate: {
      migration_version: candidate.version,
      migration_name: candidate.name
    }
  };
}

export function evaluateReadiness(payload) {
  const { root, database } = readinessParts(payload);
  const ok = root.status === "ready" && database.ok === true;
  return {
    schema_version: "1.0",
    check: "readiness-precondition-precheck",
    ok,
    detail: ok
      ? "The current production release reports database-backed readiness."
      : "The current production release is not ready before candidate activation.",
    production: {
      status: root.status,
      source_sha: typeof root.source_sha === "string" ? root.source_sha : null,
      database_ok: database.ok
    }
  };
}

export function evaluateRecovery(payload) {
  const { root, database } = readinessParts(payload);
  const authority = requireObject(database.authority, "database authority");
  const pragmas = requireObject(database.pragmas, "database pragmas");
  const integrity = requireObject(database.integrity, "database integrity");
  const providers = requireObject(root.optional_providers, "provider readiness");
  if (typeof authority.path !== "string" || typeof providers.blob !== "string") {
    throw new Error("recovery readiness fields are missing or malformed");
  }

  const durableRuntime =
    database.ok === true &&
    authority.persistent === true &&
    authority.path.startsWith("/home/data/") &&
    pragmas.journal_mode === "delete" &&
    pragmas.synchronous === "full" &&
    pragmas.foreign_keys === true &&
    integrity.quick_check === "ok" &&
    providers.blob === "azure";
  const backupFreshnessObservable = false;
  const ok = durableRuntime && backupFreshnessObservable;

  return {
    schema_version: "1.0",
    check: "recovery-precondition-precheck",
    ok,
    detail: durableRuntime
      ? "Durable runtime checks pass, but no off-host backup freshness signal is implemented."
      : "The current release does not satisfy the durable SQLite and Azure Blob recovery prerequisites.",
    durable_runtime: {
      database_ok: database.ok,
      persistent_home_data: authority.persistent === true && authority.path.startsWith("/home/data/"),
      journal_mode: pragmas.journal_mode,
      synchronous: pragmas.synchronous,
      foreign_keys: pragmas.foreign_keys,
      quick_check: integrity.quick_check,
      blob_provider: providers.blob
    },
    off_host_backup_freshness: "not-observable"
  };
}

function appSlug(webapp) {
  return webapp
    .toLowerCase()
    .replace(/^app-/, "")
    .replace(/-prod(?:-.+)?$/, "");
}

export function evaluateMonitoring(alerts, webtests, webappId, webapp) {
  if (!Array.isArray(alerts) || !Array.isArray(webtests)) {
    throw new Error("monitoring inventory is missing or malformed");
  }
  const slug = appSlug(webapp);
  const targetIds = new Set([webappId.toLowerCase()]);
  for (const test of webtests) {
    if (!isObject(test) || typeof test.id !== "string" || typeof test.name !== "string") continue;
    if (test.name.toLowerCase().includes(slug)) targetIds.add(test.id.toLowerCase());
  }

  const observed = alerts
    .filter(isObject)
    .map((alert) => {
      const scopes = Array.isArray(alert.scopes)
        ? alert.scopes.filter((scope) => typeof scope === "string")
        : [];
      const actions = Array.isArray(alert.actions) ? alert.actions : [];
      return {
        name: typeof alert.name === "string" ? alert.name : "unnamed",
        enabled: alert.enabled === true,
        target_scoped: scopes.some((scope) => targetIds.has(scope.toLowerCase())),
        action_group_count: actions.filter(
          (action) => isObject(action) && typeof action.actionGroupId === "string"
        ).length
      };
    })
    .filter((alert) => alert.target_scoped || alert.name.toLowerCase().includes(slug));

  const ok = observed.some(
    (alert) => alert.enabled && alert.target_scoped && alert.action_group_count > 0
  );
  return {
    schema_version: "1.0",
    check: "monitoring-precheck",
    ok,
    detail: ok
      ? "An enabled, target-scoped metric alert has an action group."
      : "No enabled target-scoped metric alert with an action group was found.",
    app: webapp,
    matching_webtest_count: targetIds.size - 1,
    alerts: observed
  };
}

export function evaluateProtectedConfiguration(settingNames, site, imagePrefix) {
  if (!Array.isArray(settingNames) || !settingNames.every((name) => typeof name === "string")) {
    throw new Error("app-setting name inventory is missing or malformed");
  }
  const config = requireObject(site, "site configuration");
  const missing = REQUIRED_SETTING_NAMES.filter((name) => !settingNames.includes(name));
  const imagePinned =
    typeof config.linuxFxVersion === "string" &&
    config.linuxFxVersion.startsWith(`DOCKER|${imagePrefix}@sha256:`);
  const invariants = {
    always_on: config.alwaysOn === true,
    one_worker: config.numberOfWorkers === 1,
    process_health_path: config.healthCheckPath === "/api/live",
    managed_identity_acr_pull: config.acrUseManagedIdentityCreds === true,
    immutable_image_reference: imagePinned
  };
  const ok = missing.length === 0 && Object.values(invariants).every(Boolean);
  return {
    schema_version: "1.0",
    check: "protected-configuration-precheck",
    ok,
    detail: ok
      ? "Required setting names and protected site invariants are present."
      : "Required setting names or protected site invariants are missing.",
    required_setting_names: REQUIRED_SETTING_NAMES,
    missing_setting_names: missing,
    site_invariants: invariants
  };
}

async function fetchReadiness(baseUrl) {
  const url = new URL("/api/ready", baseUrl);
  url.searchParams.set("deployment-diagnostic", `${Date.now()}`);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache"
    },
    signal: AbortSignal.timeout(READY_TIMEOUT_MS)
  });
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`readiness endpoint returned malformed JSON: ${error.message}`);
  }
}

async function azJson(args) {
  const { stdout } = await execFile(
    "az",
    [...args, "--only-show-errors", "--output", "json"],
    { timeout: AZURE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
  );
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Azure CLI returned malformed JSON: ${error.message}`);
  }
}

async function runCheck(command, options) {
  switch (command) {
    case "migration": {
      const payload = await fetchReadiness(requireOption(options, "base-url"));
      const migrationSource = readFileSync(
        resolve(options["migration-source"] ?? "src/server/db/migrations.ts"),
        "utf8"
      );
      return evaluateMigration(payload, parseCandidateMigration(migrationSource));
    }
    case "readiness":
      return evaluateReadiness(await fetchReadiness(requireOption(options, "base-url")));
    case "recovery":
      return evaluateRecovery(await fetchReadiness(requireOption(options, "base-url")));
    case "monitoring": {
      const resourceGroup = requireOption(options, "resource-group");
      const webapp = requireOption(options, "webapp");
      const site = await azJson([
        "webapp",
        "show",
        "--resource-group",
        resourceGroup,
        "--name",
        webapp,
        "--query",
        "{id:id}"
      ]);
      const webappId = requireObject(site, "web app resource").id;
      if (typeof webappId !== "string" || webappId === "") {
        throw new Error("web app resource ID is missing or malformed");
      }
      const [alerts, webtests] = await Promise.all([
        azJson(["monitor", "metrics", "alert", "list", "--resource-group", resourceGroup]),
        azJson([
          "resource",
          "list",
          "--resource-group",
          resourceGroup,
          "--resource-type",
          "Microsoft.Insights/webtests",
          "--query",
          "[].{id:id,name:name}"
        ])
      ]);
      return evaluateMonitoring(alerts, webtests, webappId, webapp);
    }
    case "protected-configuration": {
      const resourceGroup = requireOption(options, "resource-group");
      const webapp = requireOption(options, "webapp");
      const imagePrefix = requireOption(options, "image-prefix");
      const [settingNames, site] = await Promise.all([
        azJson([
          "webapp",
          "config",
          "appsettings",
          "list",
          "--resource-group",
          resourceGroup,
          "--name",
          webapp,
          "--query",
          "[].name"
        ]),
        azJson([
          "webapp",
          "config",
          "show",
          "--resource-group",
          resourceGroup,
          "--name",
          webapp,
          "--query",
          "{alwaysOn:alwaysOn,numberOfWorkers:numberOfWorkers,healthCheckPath:healthCheckPath,acrUseManagedIdentityCreds:acrUseManagedIdentityCreds,linuxFxVersion:linuxFxVersion}"
        ])
      ]);
      return evaluateProtectedConfiguration(settingNames, site, imagePrefix);
    }
    default:
      throw new Error(`unknown precheck: ${command ?? "(none)"}`);
  }
}

export async function main(argv) {
  const [command, ...rest] = argv;
  let reportPath;
  try {
    const options = parseOptions(rest);
    reportPath = resolve(requireOption(options, "report"));
    rmSync(reportPath, { force: true });
    const report = await runCheck(command, options);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.stderr.write(`${report.detail}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    if (reportPath) rmSync(reportPath, { force: true });
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Deployment precheck execution failed: ${detail}\n`);
    process.exitCode = 2;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (invokedDirectly) {
  await main(process.argv.slice(2));
}
