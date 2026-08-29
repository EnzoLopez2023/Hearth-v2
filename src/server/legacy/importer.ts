import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { HearthDatabase } from "../db/database.js";

type SourceRow = Record<string, unknown>;
type Transform = (row: SourceRow) => unknown;

interface TableMapping {
  target: string;
  id?: string[];
  makeId?: (row: SourceRow) => string;
  fields: Record<string, string[] | Transform>;
  defaults?: Record<string, unknown | Transform>;
  required?: string[];
}

const epoch = "1970-01-01T00:00:00.000Z";
const value = (...candidates: string[]): Transform => (row) => {
  for (const candidate of candidates) if (row[candidate] !== undefined && row[candidate] !== null) return row[candidate];
  return null;
};
const normalizedStatus = (fallback: string, map: Record<string, string>): Transform => (row) => {
  const raw = String(row.status ?? "").toLowerCase();
  return map[raw] ?? fallback;
};
const cents = (column: string): Transform => (row) =>
  row[column] === null || row[column] === undefined ? null : Math.round(Number(row[column]) * 100);
const fahrenheitToCelsius = (celsius: string, fahrenheit: string): Transform => (row) => {
  if (row[celsius] !== null && row[celsius] !== undefined) return row[celsius];
  return row[fahrenheit] === null || row[fahrenheit] === undefined ? null : (Number(row[fahrenheit]) - 32) * 5 / 9;
};
const jsonRow = (row: SourceRow) => JSON.stringify(normalize(row));

// Ordered by foreign-key dependency. These are the only legacy tables Hearth-v2 owns.
export const legacyMappings: Record<string, TableMapping> = {
  recipes: { target: "recipes", fields: {
    name: ["name", "title"], description: ["description"], instructions: ["instructions"], servings: ["servings"],
    prep_minutes: ["prep_minutes", "prep_time_minutes"], cook_minutes: ["cook_minutes", "cook_time_minutes"],
    tags_json: ["tags_json", "dietary_tags"]
  }, required: ["name"] },
  recipe_ingredients: { target: "recipe_ingredients", fields: {
    recipe_id: ["recipe_id"], name: ["name", "ingredient_name"], quantity: ["quantity"], unit: ["unit"], position: ["position"]
  }, defaults: { position: 0 }, required: ["recipe_id", "name"] },
  home_items: { target: "home_items", fields: {
    name: ["name"], description: ["description"], manufacturer: ["manufacturer"], model: ["model", "model_number"],
    serial_number: ["serial_number"], purchased_on: ["purchased_on", "purchase_date"],
    installed_on: ["installed_on", "installation_date"], qr_identifier: ["qr_identifier"], location: ["location"]
  }, required: ["name"] },
  maintenance_tasks: { target: "maintenance_tasks", fields: {
    home_item_id: ["home_item_id", "item_id"], title: ["title"], description: value("description", "notes"),
    due_on: value("due_on", "due_date", "scheduled_date"), recurrence_days: ["recurrence_days", "recurring_interval_days"],
    status: normalizedStatus("open", { pending: "open", overdue: "open", "in progress": "in_progress", completed: "completed", cancelled: "cancelled" }),
    completed_at: ["completed_at", "completed_date"],
    priority: (row) => ({ low: "low", medium: "normal", high: "high", critical: "urgent" }[String(row.priority ?? "").toLowerCase()] ?? "normal")
  }, required: ["title"] },
  warranties: { target: "warranties", fields: {
    home_item_id: ["home_item_id", "item_id"], provider: ["provider"], policy_number: ["policy_number", "warranty_number"],
    starts_on: ["starts_on", "start_date"], expires_on: ["expires_on", "end_date"],
    notes: value("notes", "coverage_description", "ai_summary")
  }, required: ["home_item_id"] },
  maintenance_costs: { target: "maintenance_costs", fields: {
    task_id: ["task_id"], home_item_id: ["home_item_id", "item_id"], amount_cents: (row) =>
      row.amount_cents ?? cents("amount")(row), currency: ["currency"], incurred_on: ["incurred_on", "cost_date"],
    vendor: ["vendor"], notes: value("notes", "description")
  }, defaults: { currency: "USD" }, required: ["amount_cents", "incurred_on"] },
  ai_insights: { target: "ai_insights", fields: {
    domain: () => "maintenance", subject_id: ["subject_id", "item_id"], provider: () => "legacy",
    kind: ["kind", "insight_type"], content: value("content", "description", "title"),
    status: () => "active"
  }, required: ["kind", "content"] },
  inventory_categories: { target: "inventory_categories", fields: { name: ["name"], description: ["description"] }, required: ["name"] },
  inventory_locations: { target: "inventory_locations", fields: {
    name: ["name"], description: ["description"], qr_identifier: ["qr_identifier"]
  }, required: ["name"] },
  inventory_sub_locations: { target: "inventory_sub_locations", fields: {
    location_id: ["location_id"], name: ["name"], description: ["description"]
  }, required: ["location_id", "name"] },
  inventory_items: { target: "inventory_items", fields: {
    category_id: ["category_id"], location_id: ["location_id"], sub_location_id: ["sub_location_id"],
    name: ["name"], description: value("description", "notes"), quantity: ["quantity", "qty"],
    low_quantity: ["low_quantity"], unit: ["unit"], expires_on: ["expires_on"], purchased_on: ["purchased_on", "purchase_date"],
    value_cents: (row) => row.value_cents ?? cents("current_value")(row), qr_identifier: value("qr_identifier", "barcode")
  }, defaults: { quantity: 1 }, required: ["name"] },
  pool_reports: { target: "pool_reports", fields: {
    observed_at: value("observed_at", "test_date"), status: () => "complete",
    notes: value("notes", "summary", "handwritten_notes"), water_temperature: value("water_temperature", "water_temp_f")
  }, required: ["observed_at"] },
  pool_report_results: { target: "pool_report_results", fields: {
    report_id: ["report_id"], metric: ["metric", "parameter"], value: ["value", "value_num"], unit: ["unit"],
    min_target: ["min_target", "ideal_min"], max_target: ["max_target", "ideal_max"]
  }, defaults: { unit: "" }, required: ["report_id", "metric", "value"] },
  pool_report_recommendations: { target: "pool_report_recommendations", fields: {
    report_id: ["report_id"], title: value("title", "product", "instruction"),
    detail: value("detail", "instruction", "warnings"), priority: () => "normal",
    status: (row) => row.completed_at ? "completed" : "open"
  }, required: ["report_id", "title"] },
  pool_chemicals: { target: "pool_chemicals", fields: {
    name: ["name", "product_name"], quantity: ["quantity"], unit: ["unit"], low_quantity: ["low_quantity"],
    expires_on: ["expires_on"], notes: ["notes"]
  }, defaults: { quantity: 0, unit: "lb" }, required: ["name"] },
  pool_insights: { target: "pool_insights", fields: {
    report_id: ["report_id"], provider: value("provider", "model"), content: value("content", "payload_json"), status: () => "active"
  }, defaults: { provider: "legacy" }, required: ["content"] },
  weather_daily: { target: "weather_daily", makeId: (row) =>
    `weather_${hash(`${String(row.date ?? row.observed_on)}:${String(row.lat ?? row.latitude)}:${String(row.lon ?? row.longitude)}`).slice(0, 24)}`, fields: {
    observed_on: ["observed_on", "date"], latitude: ["latitude", "lat"], longitude: ["longitude", "lon"],
    high_c: fahrenheitToCelsius("high_c", "temp_max_f"), low_c: fahrenheitToCelsius("low_c", "temp_min_f"),
    precipitation_mm: (row) => row.precipitation_mm ?? (row.precip_in == null ? null : Number(row.precip_in) * 25.4),
    conditions: ["conditions", "weather_code"], provider: ["provider"]
  }, defaults: { provider: "legacy" }, required: ["observed_on", "latitude", "longitude"] },
  yard_location: { target: "yard_location", fields: {
    name: value("name", "zip"), description: ["description"], latitude: ["latitude", "lat"],
    longitude: ["longitude", "lon"], area_sq_ft: ["area_sq_ft"], qr_identifier: ["qr_identifier"]
  }, defaults: { name: "Property" }, required: ["name"] },
  garden_fields: { target: "garden_fields", fields: {
    yard_location_id: ["yard_location_id"], name: ["name"], description: value("description", "notes")
  }, required: ["name"] },
  garden_vegetables: { target: "garden_vegetables", fields: {
    name: ["name"], variety: ["variety"], days_to_maturity: ["days_to_maturity"], notes: ["notes"]
  }, required: ["name"] },
  garden_beds: { target: "garden_beds", fields: {
    field_id: ["field_id"], name: ["name"], description: value("description", "soil_notes"),
    area_sq_ft: ["area_sq_ft"], qr_identifier: ["qr_identifier"]
  }, required: ["name"] },
  garden_plantings: { target: "garden_plantings", fields: {
    bed_id: ["bed_id"], vegetable_id: ["vegetable_id"], planted_on: value("planted_on", "sown_at", "transplanted_at"),
    expected_harvest_on: ["expected_harvest_on"], quantity: ["quantity", "qty"],
    status: normalizedStatus("planned", { planned: "planned", planted: "planted", growing: "planted", harvesting: "harvesting", finished: "finished", removed: "finished", failed: "failed" }),
    notes: value("notes", "variety")
  }, required: ["bed_id"] },
  garden_tasks: { target: "garden_tasks", fields: {
    bed_id: ["bed_id"], planting_id: ["planting_id"], title: ["title"], due_on: ["due_on", "due_date"],
    status: (row) => row.done ? "completed" : "open", priority: ["priority"], notes: value("notes", "detail")
  }, defaults: { priority: "normal" }, required: ["title"] },
  garden_harvests: { target: "garden_harvests", fields: {
    planting_id: ["planting_id"], harvested_on: ["harvested_on", "harvest_date"],
    quantity: value("quantity", "weight_oz", "qty_count"), unit: (row) => row.unit ?? (row.weight_oz != null ? "oz" : "count"),
    notes: ["notes"]
  }, required: ["planting_id", "harvested_on", "quantity"] },
  garden_settings: { target: "garden_settings", fields: {
    setting_key: (row) => `legacy:${String(row.season_year ?? row.id ?? "default")}`, value_json: jsonRow
  }, required: ["setting_key", "value_json"] },
  garden_shopping: { target: "garden_shopping", fields: {
    planting_id: ["planting_id"], name: ["name", "label"], quantity: ["quantity", "qty"], unit: ["unit"],
    status: (row) => row.checked ? "purchased" : "needed", notes: ["notes"]
  }, required: ["name"] }
};

const deferredBlobTables = ["recipe_images", "maintenance_photos", "inventory_item_images"] as const;
const deferredAttachmentColumns: Record<string, string[]> = {
  recipes: ["image_url", "images"],
  warranties: ["document_path"],
  pool_reports: ["file_data"]
};

function hasAttachment(value: unknown): boolean {
  if (Buffer.isBuffer(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalize(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { $blob_sha256: createHash("sha256").update(value).digest("hex"), byte_size: value.length };
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function canonicalRows(rows: SourceRow[]): string {
  return JSON.stringify(rows.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function hash(valueToHash: string): string {
  return createHash("sha256").update(valueToHash).digest("hex");
}

function sourceId(mapping: TableMapping, table: string, row: SourceRow): string {
  if (mapping.makeId) return mapping.makeId(row);
  for (const candidate of mapping.id ?? ["id"]) {
    if (row[candidate] !== null && row[candidate] !== undefined) return String(row[candidate]);
  }
  return `${table}_${hash(JSON.stringify(normalize(row))).slice(0, 24)}`;
}

function mappedValue(spec: string[] | Transform, row: SourceRow): unknown {
  if (typeof spec === "function") return spec(row);
  for (const column of spec) if (row[column] !== undefined && row[column] !== null) return row[column];
  return null;
}

export interface LegacyImportResult {
  status: "imported" | "no_op";
  importId: string;
  sourceNamespace: string;
  tables: Record<string, { count: number; hash: string }>;
}

export function importLegacyDatabase(options: {
  target: HearthDatabase;
  sourcePath: string;
  householdId: string;
  sourceNamespace?: string;
}): LegacyImportResult {
  const sourcePath = path.resolve(options.sourcePath);
  const sourceNamespace = options.sourceNamespace ?? `sqlite:${sourcePath}`;
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma("query_only = ON");
    const tables = new Set((source.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
    const snapshots: Record<string, { rows: SourceRow[]; count: number; hash: string }> = {};
    for (const [table] of Object.entries(legacyMappings)) {
      if (!tables.has(table)) continue;
      const columns = source.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
      if (!columns.length) throw new Error(`Cannot introspect legacy table ${table}`);
      const columnNames = new Set(columns.map((column) => column.name));
      const mapping = legacyMappings[table]!;
      for (const required of mapping.required ?? []) {
        const spec = mapping.fields[required];
        if (Array.isArray(spec) && !spec.some((candidate) => columnNames.has(candidate))
          && !(required in (mapping.defaults ?? {}))) {
          throw new Error(`Legacy schema drift in ${table}: no recognized source column for ${required}`);
        }
      }
      const rows = source.prepare(`SELECT * FROM "${table}"`).all() as SourceRow[];
      for (const attachmentColumn of deferredAttachmentColumns[table] ?? []) {
        if (columnNames.has(attachmentColumn) && rows.some((row) => hasAttachment(row[attachmentColumn]))) {
          throw new Error(
            `Legacy table ${table} contains attachment data in ${attachmentColumn}; migrate it with a configured durable blob adapter before database import`
          );
        }
      }
      const canonical = canonicalRows(rows);
      snapshots[table] = { rows, count: rows.length, hash: hash(canonical) };
    }
    for (const table of deferredBlobTables) {
      if (!tables.has(table)) continue;
      const rows = source.prepare(`SELECT * FROM "${table}"`).all() as SourceRow[];
      if (rows.length) {
        throw new Error(`Legacy table ${table} contains binary attachments; migrate it with a configured durable blob adapter before database import`);
      }
      snapshots[table] = { rows, count: 0, hash: hash(canonicalRows(rows)) };
    }
    if (!Object.keys(snapshots).length) throw new Error("Legacy source contains no owned Hearth tables");
    const sourceFingerprint = hash(JSON.stringify(Object.entries(snapshots).map(([table, item]) => [table, item.count, item.hash])));
    const existing = options.target.prepare(`
      SELECT id,source_fingerprint FROM legacy_imports WHERE household_id=? AND source_namespace=?
    `).get(options.householdId, sourceNamespace) as { id: string; source_fingerprint: string } | undefined;
    if (existing) {
      const reconciled = options.target.prepare(`
        SELECT source_table,row_count,canonical_hash FROM legacy_reconciliation WHERE import_id=? ORDER BY source_table
      `).all(existing.id) as { source_table: string; row_count: number; canonical_hash: string }[];
      const exact = existing.source_fingerprint === sourceFingerprint
        && reconciled.length === Object.keys(snapshots).length
        && reconciled.every((row) => snapshots[row.source_table]?.count === row.row_count
          && snapshots[row.source_table]?.hash === row.canonical_hash);
      if (!exact) throw new Error("Legacy import conflict: source differs from its recorded reconciliation");
      return {
        status: "no_op", importId: existing.id, sourceNamespace,
        tables: Object.fromEntries(Object.entries(snapshots).map(([table, item]) => [table, { count: item.count, hash: item.hash }]))
      };
    }
    if (!options.target.prepare("SELECT 1 FROM households WHERE id=?").get(options.householdId)) {
      throw new Error(`Target household ${options.householdId} does not exist`);
    }
    const importId = `lim_${randomUUID().replaceAll("-", "")}`;
    options.target.transaction(() => {
      const now = new Date().toISOString();
      options.target.prepare(`
        INSERT INTO legacy_imports(id,household_id,source_namespace,source_fingerprint,imported_at) VALUES(?,?,?,?,?)
      `).run(importId, options.householdId, sourceNamespace, sourceFingerprint, now);
      for (const [table, snapshot] of Object.entries(snapshots)) {
        const mapping = legacyMappings[table]!;
        for (const sourceRow of snapshot.rows) {
          const id = sourceId(mapping, table, sourceRow);
          if (options.target.prepare(`SELECT 1 FROM ${mapping.target} WHERE id=?`).get(id)) {
            throw new Error(`Legacy import conflict: ${mapping.target} id ${id} already exists`);
          }
          const data: Record<string, unknown> = {};
          for (const [targetColumn, spec] of Object.entries(mapping.fields)) data[targetColumn] = mappedValue(spec, sourceRow);
          for (const [targetColumn, fallback] of Object.entries(mapping.defaults ?? {})) {
            if (data[targetColumn] === null || data[targetColumn] === undefined) {
              data[targetColumn] = typeof fallback === "function" ? fallback(sourceRow) : fallback;
            }
          }
          for (const required of mapping.required ?? []) {
            if (data[required] === null || data[required] === undefined || data[required] === "") {
              throw new Error(`Legacy ${table} row ${id} is missing required mapped field ${required}`);
            }
          }
          const createdAt = String(sourceRow.created_at ?? sourceRow.uploaded_at ?? epoch);
          const updatedAt = String(sourceRow.updated_at ?? createdAt);
          const entries = Object.entries(data).filter(([, item]) => item !== null && item !== undefined);
          const columns = entries.map(([column]) => column);
          options.target.prepare(`
            INSERT INTO ${mapping.target}(id,household_id,created_at,updated_at${columns.length ? `,${columns.join(",")}` : ""})
            VALUES(?,?,?,?${columns.map(() => ",?").join("")})
          `).run(id, options.householdId, createdAt, updatedAt, ...entries.map(([, item]) => item));
          options.target.prepare(`
            INSERT INTO legacy_identifier_map
            (id,household_id,source_namespace,source_table,source_id,target_table,target_id,identifier_kind,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)
          `).run(`lid_${randomUUID().replaceAll("-", "")}`, options.householdId, sourceNamespace, table, id,
            mapping.target, id, "legacy", now);
        }
        options.target.prepare(`
          INSERT INTO legacy_reconciliation(id,import_id,source_table,row_count,canonical_hash) VALUES(?,?,?,?,?)
        `).run(`lrc_${randomUUID().replaceAll("-", "")}`, importId, table, snapshot.count, snapshot.hash);
      }
    })();
    return {
      status: "imported", importId, sourceNamespace,
      tables: Object.fromEntries(Object.entries(snapshots).map(([table, item]) => [table, { count: item.count, hash: item.hash }]))
    };
  } finally {
    source.close();
  }
}
