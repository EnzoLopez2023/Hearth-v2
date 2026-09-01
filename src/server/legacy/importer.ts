import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { HearthDatabase } from "../db/database.js";
import type { BlobProvider } from "../providers/index.js";

type SourceRow = Record<string, unknown>;
type Transform = (row: SourceRow) => unknown;
const recipeMappingVersion = 2;
const legacyMappingVersion = 3;

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
const dateValue = (...candidates: string[]): Transform => (row) => {
  const raw = value(...candidates)(row);
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match) throw new Error(`Invalid legacy date ${text}`);
  return match[1];
};
const dateTimeValue = (...candidates: string[]): Transform => (row) => {
  const raw = value(...candidates)(row);
  if (raw === null || raw === undefined || raw === "") return null;
  return normalizeTimestamp(raw);
};
const combinedText = (candidates: string[]): Transform => (row) => {
  const parts = candidates
    .map((candidate) => row[candidate])
    .filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
    .map(String);
  return parts.length ? [...new Set(parts)].join("\n\n") : null;
};
const labeledText = (fields: [string, string][]): Transform => (row) => {
  const parts = fields
    .filter(([, column]) => row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== "")
    .map(([label, column]) => label ? `${label}: ${String(row[column])}` : String(row[column]));
  return parts.length ? parts.join("\n") : null;
};
const normalizedStatus = (fallback: string, map: Record<string, string>): Transform => (row) => {
  const raw = String(row.status ?? "").toLowerCase();
  return map[raw] ?? fallback;
};
const cents = (column: string): Transform => (row) =>
  row[column] === null || row[column] === undefined ? null : Math.round(Number(row[column]) * 100);
const positiveNumberValue = (...candidates: string[]): Transform => (row) => {
  const raw = value(...candidates)(row);
  if (raw === null || raw === undefined || raw === "") return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) throw new Error(`Invalid legacy number ${String(raw)}`);
  return number > 0 ? number : null;
};
const fahrenheitToCelsius = (celsius: string, fahrenheit: string): Transform => (row) => {
  if (row[celsius] !== null && row[celsius] !== undefined) return row[celsius];
  return row[fahrenheit] === null || row[fahrenheit] === undefined ? null : (Number(row[fahrenheit]) - 32) * 5 / 9;
};
const jsonRow = (row: SourceRow) => JSON.stringify(normalize(row));
const jsonValue = (...candidates: string[]): Transform => (row) => {
  const raw = value(...candidates)(row);
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return JSON.stringify(normalize(typeof raw === "string" ? JSON.parse(raw) : raw));
  } catch {
    throw new Error(`Legacy JSON field ${candidates.join("/")} is invalid`);
  }
};
const jsonProperty = (column: string, property: string): Transform => (row) => {
  const raw = row[column];
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
    return parsed[property] ?? null;
  } catch {
    throw new Error(`Legacy JSON field ${column} is invalid`);
  }
};
const booleanInteger = (...candidates: string[]): Transform => (row) => {
  const raw = value(...candidates)(row);
  if (raw === null || raw === undefined || raw === "") return 0;
  if (raw === true || raw === 1 || raw === "1" || String(raw).toLowerCase() === "true") return 1;
  if (raw === false || raw === 0 || raw === "0" || String(raw).toLowerCase() === "false") return 0;
  throw new Error(`Legacy boolean field ${candidates.join("/")} is invalid`);
};
const yardProfile = (column: string, profileKey: string): Transform => (row) => {
  if (row[column] !== null && row[column] !== undefined) return row[column];
  if (!row.profile_json) return null;
  try {
    const profile = JSON.parse(String(row.profile_json)) as Record<string, unknown>;
    return profile[profileKey] ?? null;
  } catch {
    throw new Error("Legacy yard_location profile_json is invalid");
  }
};
const yardDescription: Transform = (row) => row.profile_json ? String(row.profile_json) : null;

// Ordered by foreign-key dependency. These are the only legacy tables Hearth-v2 owns.
export const legacyMappings: Record<string, TableMapping> = {
  recipes: { target: "recipes", fields: {
    name: ["name", "title"], description: ["description"], instructions: ["instructions"], servings: ["servings"],
    prep_minutes: ["prep_minutes", "prep_time_minutes"], cook_minutes: ["cook_minutes", "cook_time_minutes"],
    total_minutes: positiveNumberValue("total_minutes", "total_time_minutes"), cuisine_type: ["cuisine_type"],
    meal_type: ["meal_type"], difficulty_level: ["difficulty_level"], notes: ["notes"],
    source_url: ["source_url"], is_favorite: booleanInteger("is_favorite"), rating: ["rating"],
    parsed_by_ai: booleanInteger("parsed_by_ai"), ai_suggestions: ["ai_suggestions"],
    tags_json: jsonValue("tags_json", "dietary_tags"), nutrition_json: jsonValue("nutrition_json", "nutrition")
  }, defaults: { meal_type: "dinner", difficulty_level: "medium" }, required: ["name"] },
  recipe_ingredients: { target: "recipe_ingredients", fields: {
    recipe_id: ["recipe_id"], name: ["name", "ingredient_name"], quantity: ["quantity"],
    unit: ["unit"], notes: ["notes"], position: ["position"]
  }, defaults: { position: 0 }, required: ["recipe_id", "name"] },
  home_items: { target: "home_items", fields: {
    name: ["name"], description: ["description"], manufacturer: ["manufacturer"], model: ["model", "model_number"],
    serial_number: ["serial_number"], purchased_on: dateValue("purchased_on", "purchase_date"),
    installed_on: dateValue("installed_on", "installation_date"), qr_identifier: ["qr_identifier"], location: ["location"],
    category: ["category"], estimated_lifespan_years: ["estimated_lifespan_years"],
    replacement_cost_cents: (row) => row.replacement_cost_cents ?? cents("replacement_cost")(row)
  }, defaults: { category: "Other" }, required: ["name"] },
  maintenance_tasks: { target: "maintenance_tasks", fields: {
    home_item_id: ["home_item_id", "item_id"], title: ["title"], description: ["description"],
    due_on: dateValue("due_on", "due_date", "scheduled_date"), recurrence_days: ["recurrence_days", "recurring_interval_days"],
    status: normalizedStatus("open", { pending: "open", overdue: "open", "in progress": "in_progress", completed: "completed", cancelled: "cancelled" }),
    completed_at: dateTimeValue("completed_at", "completed_date"),
    priority: (row) => ({ low: "low", medium: "normal", high: "high", critical: "urgent" }[String(row.priority ?? "").toLowerCase()] ?? "normal"),
    task_type: ["task_type"], scheduled_on: dateValue("scheduled_on", "scheduled_date"),
    estimated_duration_hours: ["estimated_duration_hours"], actual_duration_hours: ["actual_duration_hours"],
    next_due_on: dateValue("next_due_on", "next_due_date"), assigned_to: ["assigned_to"],
    notes: ["notes"], ai_generated: booleanInteger("ai_generated")
  }, defaults: { task_type: "Scheduled" }, required: ["title"] },
  warranties: { target: "warranties", fields: {
    home_item_id: ["home_item_id", "item_id"], provider: ["provider"], policy_number: ["policy_number", "warranty_number"],
    starts_on: dateValue("starts_on", "start_date"), expires_on: dateValue("expires_on", "end_date"),
    notes: value("notes", "coverage_description"), warranty_type: ["warranty_type"],
    claim_process: ["claim_process"], contact_info: ["contact_info"], is_active: booleanInteger("is_active"),
    ai_analyzed: booleanInteger("ai_analyzed"), ai_summary: ["ai_summary"]
  }, defaults: { warranty_type: "Manufacturer", is_active: 1 }, required: ["home_item_id"] },
  maintenance_costs: { target: "maintenance_costs", fields: {
    task_id: ["task_id"], home_item_id: ["home_item_id", "item_id"], amount_cents: (row) =>
      row.amount_cents ?? cents("amount")(row), currency: ["currency"], incurred_on: dateValue("incurred_on", "cost_date"),
    vendor: ["vendor"], notes: ["notes"], cost_type: ["cost_type"], description: ["description"],
    tax_cents: (row) => row.tax_cents ?? cents("tax_amount")(row),
    warranty_covered: booleanInteger("warranty_covered"), ai_categorized: booleanInteger("ai_categorized")
  }, defaults: { currency: "USD" }, required: ["amount_cents", "incurred_on"] },
  ai_insights: { target: "ai_insights", fields: {
    domain: () => "maintenance", subject_id: ["subject_id", "item_id"], provider: () => "legacy",
    kind: ["kind", "insight_type"], content: value("content", "description", "title"),
    status: (row) => ({ new: "active", acknowledged: "active", "acted upon": "acted_on", dismissed: "dismissed" }[
      String(row.status ?? "").toLowerCase()
    ] ?? "active"),
    title: ["title"], confidence_score: ["confidence_score"],
    priority: (row) => ({ low: "low", medium: "normal", high: "high", critical: "urgent" }[
      String(row.priority ?? "").toLowerCase()
    ] ?? "normal"),
    predicted_on: dateValue("predicted_on", "predicted_date"),
    predicted_cost_cents: (row) => row.predicted_cost_cents ?? cents("predicted_cost")(row),
    source_data: ["source_data"]
  }, required: ["kind", "content"] },
  inventory_categories: { target: "inventory_categories", fields: {
    name: ["name"], description: ["description"], icon: ["icon"], color: ["color"], sort_order: ["sort_order"]
  }, defaults: { sort_order: 0 }, required: ["name"] },
  inventory_locations: { target: "inventory_locations", fields: {
    name: ["name"], description: ["description"], qr_identifier: ["qr_identifier"], sort_order: ["sort_order"]
  }, defaults: { sort_order: 0 }, required: ["name"] },
  inventory_sub_locations: { target: "inventory_sub_locations", fields: {
    location_id: ["location_id"], name: ["name"], description: ["description"], sort_order: ["sort_order"]
  }, defaults: { sort_order: 0 }, required: ["location_id", "name"] },
  inventory_items: { target: "inventory_items", fields: {
    category_id: ["category_id"], location_id: ["location_id"], sub_location_id: ["sub_location_id"],
    maintenance_item_id: ["maintenance_item_id"], name: ["name"], description: ["description"], quantity: ["quantity", "qty"],
    low_quantity: ["low_quantity"], unit: ["unit"], expires_on: dateValue("expires_on"), purchased_on: dateValue("purchased_on", "purchase_date"),
    value_cents: (row) => row.value_cents ?? cents("current_value")(row),
    qr_identifier: value("qr_identifier", "barcode"),
    condition: ["condition"], status: ["status"], brand: ["brand"], model: ["model"],
    serial_number: ["serial_number"], barcode: ["barcode"], sku: ["sku"], purchased_from: ["purchased_from"],
    purchase_price_cents: (row) => row.purchase_price_cents ?? cents("purchase_price")(row),
    product_url: ["product_url"], notes: ["notes"], ai_identified: booleanInteger("ai_identified")
  }, defaults: { quantity: 1 }, required: ["name"] },
  pool_reports: { target: "pool_reports", fields: {
    observed_at: dateTimeValue("observed_at", "test_date", "test_date_text"), status: () => "complete",
    notes: ["notes"], water_temperature: value("water_temperature", "water_temp_f"),
    water_temperature_f: value("water_temperature_f", "water_temp_f"), test_date_text: ["test_date_text"],
    report_format: ["report_format"], store_name: ["store_name"], analyst_name: ["analyst_name"],
    test_id: ["test_id"], pool_volume_gal: ["pool_volume_gal"], pool_type: ["pool_type"],
    filter_type: ["filter_type"], test_kind: ["test_kind"], custom_ideals: booleanInteger("custom_ideals"),
    summary: ["summary"], handwritten_notes: ["handwritten_notes"], file_hash: ["file_hash"],
    raw_parse_json: ["raw_parse_json"], parse_model: ["parse_model"], parse_status: ["parse_status"],
    parse_error: ["parse_error"], verified_at: dateTimeValue("verified_at")
  }, defaults: { report_format: "unknown", parse_status: "parsed" }, required: ["observed_at"] },
  pool_report_results: { target: "pool_report_results", fields: {
    report_id: ["report_id"], metric: ["metric", "parameter"], parameter_label: ["parameter_label"],
    value: ["value", "value_num"], value_text: ["value_text"], unit: ["unit"], ideal_text: ["ideal_text"],
    min_target: ["min_target", "ideal_min"], max_target: ["max_target", "ideal_max"],
    status: ["status"], position: value("position", "sort_order")
  }, defaults: { position: 0 }, required: ["report_id", "metric"] },
  pool_report_recommendations: { target: "pool_report_recommendations", fields: {
    report_id: ["report_id"], title: value("title", "product", "instruction"),
    detail: labeledText([
      ["Source", "source"], ["", "instruction"], ["Quantity", "quantity"], ["Target", "target"],
      ["Timing", "timing"], ["Warnings", "warnings"]
    ]), priority: () => "normal", status: (row) => row.completed_at ? "completed" : "open",
    source: ["source"], product: ["product"], instruction: value("instruction", "title"),
    quantity_text: value("quantity_text", "quantity"), target: ["target"], timing: ["timing"],
    warnings: ["warnings"], completed_at: dateTimeValue("completed_at"),
    position: value("position", "sort_order")
  }, required: ["report_id", "title"] },
  pool_chemicals: { target: "pool_chemicals", fields: {
    name: ["name", "product_name"], quantity: value("quantity", "net_weight_lbs"), unit: ["unit"], low_quantity: ["low_quantity"],
    expires_on: dateValue("expires_on"), notes: ["notes"], category: ["category"],
    product_name: ["product_name"], brand: ["brand"], active_ingredient: ["active_ingredient"],
    active_percent: ["active_percent"], available_chlorine_percent: ["available_chlorine_percent"],
    net_weight_lbs: ["net_weight_lbs"]
  }, defaults: { quantity: 0, unit: "lb", category: "other" }, required: ["name"] },
  pool_insights: { target: "pool_insights", fields: {
    report_id: ["report_id"], provider: value("provider", "model"), content: value("content", "payload_json"),
    status: () => "active", payload_json: jsonValue("payload_json"), report_count: ["report_count"],
    water_health: jsonProperty("payload_json", "water_health"),
    model: ["model"], generated_at: dateTimeValue("generated_at")
  }, defaults: { provider: "legacy", report_count: 0 }, required: ["content"] },
  weather_daily: { target: "weather_daily", makeId: (row) =>
    `weather_${hash(`${String(row.date ?? row.observed_on)}:${String(row.lat ?? row.latitude)}:${String(row.lon ?? row.longitude)}`).slice(0, 24)}`, fields: {
    observed_on: ["observed_on", "date"], latitude: ["latitude", "lat"], longitude: ["longitude", "lon"],
    high_c: fahrenheitToCelsius("high_c", "temp_max_f"), low_c: fahrenheitToCelsius("low_c", "temp_min_f"),
    precipitation_mm: (row) => row.precipitation_mm ?? (row.precip_in == null ? null : Number(row.precip_in) * 25.4),
    conditions: ["conditions"], provider: ["provider"], weather_code: ["weather_code"],
    fetched_at: dateTimeValue("fetched_at")
  }, defaults: { provider: "legacy" }, required: ["observed_on", "latitude", "longitude"] },
  yard_location: { target: "yard_location", fields: {
    name: value("name", "zip"), description: yardDescription, latitude: yardProfile("latitude", "lat"),
    longitude: yardProfile("longitude", "lon"), area_sq_ft: ["area_sq_ft"], qr_identifier: ["qr_identifier"],
    zip: ["zip"], profile_json: jsonValue("profile_json"), profile_at: dateTimeValue("profile_at")
  }, defaults: { name: "Property" }, required: ["name"] },
  garden_fields: { target: "garden_fields", fields: {
    yard_location_id: ["yard_location_id"], name: ["name"], description: value("description", "notes"),
    sort_order: ["sort_order"]
  }, defaults: { sort_order: 0 }, required: ["name"] },
  garden_vegetables: { target: "garden_vegetables", fields: {
    name: ["name"], variety: ["variety"], days_to_maturity: ["days_to_maturity"], notes: ["notes"],
    slug: ["slug"], latin: ["latin"], family: ["family"], emoji: ["emoji"],
    sow_start_month: ["sow_start_month"], sow_end_month: ["sow_end_month"],
    harvest_start_month: ["harvest_start_month"], harvest_end_month: ["harvest_end_month"],
    spacing_in: ["spacing_in"], row_spacing_in: ["row_spacing_in"], depth_in: ["depth_in"],
    sun: ["sun"], water: ["water"], days_to_germinate: ["days_to_germinate"],
    indoor_start_weeks_before_frost: ["indoor_start_weeks_before_frost"],
    transplant_weeks_after_frost: ["transplant_weeks_after_frost"],
    frost_tolerance: ["frost_tolerance"], companions_json: jsonValue("companions_json"),
    antagonists_json: jsonValue("antagonists_json"), is_custom: booleanInteger("is_custom"),
    is_favorite: booleanInteger("is_favorite")
  }, required: ["name"] },
  garden_beds: { target: "garden_beds", fields: {
    field_id: ["field_id"], name: ["name"], description: ["description"],
    area_sq_ft: ["area_sq_ft"], qr_identifier: ["qr_identifier"], shape: ["shape"],
    width_in: ["width_in"], height_in: ["height_in"], pos_x: ["pos_x"], pos_y: ["pos_y"],
    rotation_deg: ["rotation_deg"], sun_exposure: ["sun_exposure"], soil_notes: ["soil_notes"]
  }, defaults: { shape: "rect", pos_x: 0, pos_y: 0, rotation_deg: 0 }, required: ["name"] },
  garden_plantings: { target: "garden_plantings", fields: {
    bed_id: ["bed_id"], vegetable_id: ["vegetable_id"], planted_on: dateValue("planted_on", "sown_at", "transplanted_at"),
    expected_harvest_on: dateValue("expected_harvest_on"), quantity: ["quantity", "qty"],
    status: normalizedStatus("planned", { planned: "planned", planted: "planted", growing: "planted", harvesting: "harvesting", finished: "finished", removed: "finished", failed: "failed" }),
    notes: ["notes"], variety: ["variety"], season_year: ["season_year"], pos_x: ["pos_x"], pos_y: ["pos_y"],
    sown_at: dateValue("sown_at"), transplanted_at: dateValue("transplanted_at"),
    first_harvest_at: dateValue("first_harvest_at"), removed_at: dateValue("removed_at")
  }, required: ["bed_id"] },
  garden_tasks: { target: "garden_tasks", fields: {
    bed_id: ["bed_id"], planting_id: ["planting_id"], field_id: ["field_id"], title: ["title"],
    due_on: dateValue("due_on", "due_date"), status: (row) => row.done ? "completed" : "open",
    priority: ["priority"], notes: value("notes", "detail"), kind: ["kind"],
    done_at: dateTimeValue("done_at"), source: ["source"]
  }, defaults: { priority: "normal", source: "manual" }, required: ["title"] },
  garden_harvests: { target: "garden_harvests", fields: {
    planting_id: ["planting_id"], harvested_on: dateValue("harvested_on", "harvest_date"),
    quantity: value("quantity", "weight_oz", "qty_count"), unit: (row) => row.unit ?? (row.weight_oz != null ? "oz" : "count"),
    notes: ["notes"], weight_oz: ["weight_oz"], qty_count: ["qty_count"], quality: ["quality"]
  }, required: ["planting_id", "harvested_on", "quantity"] },
  garden_settings: { target: "garden_settings", fields: {
    setting_key: (row) => `legacy:${String(row.season_year ?? row.id ?? "default")}`, value_json: jsonRow,
    season_year: ["season_year"], active_field_id: ["active_field_id"], units: ["units"]
  }, required: ["setting_key", "value_json"] },
  garden_shopping: { target: "garden_shopping", fields: {
    planting_id: ["planting_id"], vegetable_id: ["vegetable_id"], name: ["name", "label"],
    quantity: ["quantity"], quantity_text: value("quantity_text", "qty"), unit: ["unit"],
    status: (row) => row.checked ? "purchased" : "needed", notes: ["notes"], season_year: ["season_year"]
  }, required: ["name"] }
};

const attachmentTables = ["recipe_images", "maintenance_photos", "inventory_item_images"] as const;

function hasAttachment(value: unknown): boolean {
  if (Buffer.isBuffer(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizeTimestamp(raw: unknown): string {
  const text = String(raw).trim();
  if (!text) return epoch;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00.000Z`
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)
      ? `${text.replace(" ", "T")}${text.endsWith("Z") ? "" : "Z"}`
      : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid legacy timestamp ${text}`);
  return parsed.toISOString();
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

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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

interface MappedRow {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function mapLegacyRows(
  table: string,
  mapping: TableMapping,
  rows: SourceRow[],
  reportsWithHandwrittenRecommendations: ReadonlySet<string> = new Set()
): MappedRow[] {
  return rows.map((sourceRow) => {
    const id = sourceId(mapping, table, sourceRow);
    const data: Record<string, unknown> = {};
    for (const [targetColumn, spec] of Object.entries(mapping.fields)) {
      data[targetColumn] = mappedValue(spec, sourceRow);
    }
    for (const [targetColumn, fallback] of Object.entries(mapping.defaults ?? {})) {
      if (data[targetColumn] === null || data[targetColumn] === undefined) {
        data[targetColumn] = typeof fallback === "function" ? fallback(sourceRow) : fallback;
      }
    }
    for (const [targetColumn, item] of Object.entries(data)) {
      if (targetColumn.endsWith("_id") && item !== null && item !== undefined) {
        data[targetColumn] = String(item);
      }
    }
    if (table === "pool_report_recommendations"
      && !sourceRow.completed_at
      && String(sourceRow.source).toLowerCase() === "computer"
      && reportsWithHandwrittenRecommendations.has(String(sourceRow.report_id))) {
      data.status = "dismissed";
    }
    for (const required of mapping.required ?? []) {
      if (data[required] === null || data[required] === undefined || data[required] === "") {
        throw new Error(`Legacy ${table} row ${id} is missing required mapped field ${required}`);
      }
    }
    const createdAt = normalizeTimestamp(sourceRow.created_at ?? sourceRow.uploaded_at ?? sourceRow.generated_at ?? epoch);
    const updatedAt = normalizeTimestamp(sourceRow.updated_at ?? createdAt);
    return { id, data, createdAt, updatedAt };
  });
}

function upgradeLegacyRecipeFields(
  target: HearthDatabase,
  householdId: string,
  importId: string,
  snapshots: Record<string, { rows: SourceRow[]; count: number; hash: string }>
): void {
  const recipes = mapLegacyRows("recipes", legacyMappings.recipes!, snapshots.recipes?.rows ?? []);
  const ingredients = mapLegacyRows(
    "recipe_ingredients",
    legacyMappings.recipe_ingredients!,
    snapshots.recipe_ingredients?.rows ?? []
  );
  target.transaction(() => {
    for (const row of recipes) {
      const current = target.prepare(`
        SELECT cuisine_type,meal_type,total_minutes,difficulty_level,notes,source_url,is_favorite,
          rating,parsed_by_ai,ai_suggestions,nutrition_json
        FROM recipes WHERE id=? AND household_id=?
      `).get(row.id, householdId) as {
        cuisine_type: string | null;
        meal_type: string;
        total_minutes: number | null;
        difficulty_level: string;
        notes: string | null;
        source_url: string | null;
        is_favorite: number;
        rating: number | null;
        parsed_by_ai: number;
        ai_suggestions: string | null;
        nutrition_json: string | null;
      } | undefined;
      if (!current) throw new Error(`Legacy mapping upgrade conflict: recipe ${row.id} is missing`);
      const untouched = current.cuisine_type === null
        && current.meal_type === "dinner"
        && current.total_minutes === null
        && current.difficulty_level === "medium"
        && current.notes === null
        && current.source_url === null
        && current.is_favorite === 0
        && current.rating === null
        && current.parsed_by_ai === 0
        && current.ai_suggestions === null
        && current.nutrition_json === null;
      if (!untouched) {
        throw new Error(`Legacy mapping upgrade conflict: recipe ${row.id} has newer field changes`);
      }
      target.prepare(`
        UPDATE recipes SET cuisine_type=?,meal_type=?,total_minutes=?,difficulty_level=?,notes=?,
          source_url=?,is_favorite=?,rating=?,parsed_by_ai=?,ai_suggestions=?,nutrition_json=?
        WHERE id=? AND household_id=?
      `).run(
        row.data.cuisine_type ?? null,
        row.data.meal_type ?? "dinner",
        row.data.total_minutes ?? null,
        row.data.difficulty_level ?? "medium",
        row.data.notes ?? null,
        row.data.source_url ?? null,
        row.data.is_favorite ?? 0,
        row.data.rating ?? null,
        row.data.parsed_by_ai ?? 0,
        row.data.ai_suggestions ?? null,
        row.data.nutrition_json ?? null,
        row.id,
        householdId
      );
    }
    for (const row of ingredients) {
      const current = target.prepare(`
        SELECT notes FROM recipe_ingredients WHERE id=? AND household_id=?
      `).get(row.id, householdId) as { notes: string | null } | undefined;
      if (!current) throw new Error(`Legacy mapping upgrade conflict: recipe ingredient ${row.id} is missing`);
      if (current.notes !== null) {
        throw new Error(`Legacy mapping upgrade conflict: recipe ingredient ${row.id} has newer field changes`);
      }
      target.prepare("UPDATE recipe_ingredients SET notes=? WHERE id=? AND household_id=?")
        .run(row.data.notes ?? null, row.id, householdId);
    }
    target.prepare("UPDATE legacy_imports SET mapping_version=? WHERE id=? AND household_id=?")
      .run(recipeMappingVersion, importId, householdId);
  })();
}

interface AttachmentPlan {
  sourceTable: string;
  sourceId: string;
  dataColumn: string;
  bytes: Buffer;
  contentType: string;
  originalName: string | null;
  createdAt: string;
  updatedAt: string;
  link?: {
    targetTable: "recipe_images" | "maintenance_photos" | "inventory_item_images";
    id: string;
    data: Record<string, unknown>;
  };
}

interface StoredAttachment extends AttachmentPlan {
  blobId: string;
  blobKey: string;
  byteSize: number;
  sha256: string;
  created: boolean;
}

function requiredText(row: SourceRow, column: string, table: string, id: string): string {
  const raw = row[column];
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    throw new Error(`Legacy ${table} row ${id} is missing ${column}`);
  }
  return String(raw);
}

function attachmentBytes(row: SourceRow, column: string, table: string, id: string): Buffer {
  const bytes = row[column];
  if (!Buffer.isBuffer(bytes) || !bytes.length) {
    throw new Error(`Legacy ${table} row ${id} has invalid ${column}`);
  }
  const declared = row.file_size ?? row.photo_size ?? row.image_size;
  if (declared !== null && declared !== undefined && Number(declared) !== bytes.length) {
    throw new Error(`Legacy ${table} row ${id} attachment size does not match`);
  }
  return bytes;
}

function buildAttachmentPlans(
  snapshots: Record<string, { rows: SourceRow[]; count: number; hash: string }>
): AttachmentPlan[] {
  const plans: AttachmentPlan[] = [];
  const positions = new Map<string, number>();
  const recipeImagePositions = new Map<string, number>();
  const nextRecipePosition = new Map<string, number>();
  for (const recipe of snapshots.recipes?.rows ?? []) {
    if (!hasAttachment(recipe.images)) continue;
    const references = JSON.parse(String(recipe.images)) as string[];
    for (const [position, reference] of references.entries()) {
      const match = /^\/api\/recipe-images\/(\d+)$/.exec(reference);
      if (!match) throw new Error(`Legacy recipe ${String(recipe.id)} has an unrecognized image reference`);
      const imageId = match[1]!;
      const image = (snapshots.recipe_images?.rows ?? []).find((row) => String(row.id) === imageId);
      if (!image || String(image.recipe_id) !== String(recipe.id)) {
        throw new Error(`Legacy recipe ${String(recipe.id)} image reference ${imageId} does not match a durable image row`);
      }
      recipeImagePositions.set(imageId, position);
    }
    nextRecipePosition.set(String(recipe.id), references.length);
  }
  const nextPosition = (table: string, parent: string) => {
    const key = `${table}:${parent}`;
    const position = positions.get(key) ?? 0;
    positions.set(key, position + 1);
    return position;
  };
  const created = (row: SourceRow) => normalizeTimestamp(row.created_at ?? row.uploaded_at ?? row.taken_date ?? epoch);

  for (const row of snapshots.recipe_images?.rows ?? []) {
    const id = sourceId({ target: "recipe_images", fields: {} }, "recipe_images", row);
    const recipeId = requiredText(row, "recipe_id", "recipe_images", id);
    const position = recipeImagePositions.get(id) ?? nextRecipePosition.get(recipeId) ?? 0;
    if (!recipeImagePositions.has(id)) nextRecipePosition.set(recipeId, position + 1);
    plans.push({
      sourceTable: "recipe_images",
      sourceId: id,
      dataColumn: "file_data",
      bytes: attachmentBytes(row, "file_data", "recipe_images", id),
      contentType: requiredText(row, "file_type", "recipe_images", id),
      originalName: requiredText(row, "file_name", "recipe_images", id),
      createdAt: created(row),
      updatedAt: created(row),
      link: {
        targetTable: "recipe_images",
        id,
        data: {
          recipe_id: recipeId,
          blob_id: null,
          alt_text: row.file_name ?? null,
          position
        }
      }
    });
  }
  for (const row of snapshots.maintenance_photos?.rows ?? []) {
    const id = sourceId({ target: "maintenance_photos", fields: {} }, "maintenance_photos", row);
    plans.push({
      sourceTable: "maintenance_photos",
      sourceId: id,
      dataColumn: "photo_data",
      bytes: attachmentBytes(row, "photo_data", "maintenance_photos", id),
      contentType: requiredText(row, "photo_type", "maintenance_photos", id),
      originalName: requiredText(row, "photo_name", "maintenance_photos", id),
      createdAt: created(row),
      updatedAt: created(row),
      link: {
        targetTable: "maintenance_photos",
        id,
        data: {
          task_id: row.task_id === null || row.task_id === undefined ? null : String(row.task_id),
          home_item_id: row.home_item_id === null || row.home_item_id === undefined
            ? row.item_id === null || row.item_id === undefined ? null : String(row.item_id)
            : String(row.home_item_id),
          blob_id: null,
          caption: row.description ?? null,
          photo_category: row.photo_category ?? "General",
          taken_at: dateTimeValue("taken_at", "taken_date")(row),
          ai_analyzed: booleanInteger("ai_analyzed")(row),
          ai_description: row.ai_description ?? null,
          ai_tags_json: jsonValue("ai_tags_json", "ai_tags")(row)
        }
      }
    });
  }
  for (const row of snapshots.inventory_item_images?.rows ?? []) {
    const id = sourceId({ target: "inventory_item_images", fields: {} }, "inventory_item_images", row);
    const itemId = String(row.inventory_item_id ?? row.item_id ?? "");
    if (!itemId) throw new Error(`Legacy inventory_item_images row ${id} is missing item_id`);
    plans.push({
      sourceTable: "inventory_item_images",
      sourceId: id,
      dataColumn: "image_data",
      bytes: attachmentBytes(row, "image_data", "inventory_item_images", id),
      contentType: requiredText(row, "image_type", "inventory_item_images", id),
      originalName: requiredText(row, "image_name", "inventory_item_images", id),
      createdAt: created(row),
      updatedAt: created(row),
      link: {
        targetTable: "inventory_item_images",
        id,
        data: {
          inventory_item_id: itemId,
          blob_id: null,
          alt_text: row.image_role ?? row.image_name ?? null,
          position: Number(row.position ?? row.sort_order ?? nextPosition("inventory_item_images", itemId)),
          image_role: row.image_role ?? "photo"
        }
      }
    });
  }
  for (const row of snapshots.pool_reports?.rows ?? []) {
    if (!hasAttachment(row.file_data)) continue;
    const id = sourceId(legacyMappings.pool_reports!, "pool_reports", row);
    plans.push({
      sourceTable: "pool_reports",
      sourceId: id,
      dataColumn: "file_data",
      bytes: attachmentBytes(row, "file_data", "pool_reports", id),
      contentType: requiredText(row, "file_type", "pool_reports", id),
      originalName: requiredText(row, "file_name", "pool_reports", id),
      createdAt: created(row),
      updatedAt: normalizeTimestamp(row.updated_at ?? row.created_at ?? epoch)
    });
  }
  return plans;
}

function validateExternalAttachments(
  snapshots: Record<string, { rows: SourceRow[]; count: number; hash: string }>
): void {
  for (const row of snapshots.recipes?.rows ?? []) {
    if (hasAttachment(row.image_url)) {
      throw new Error("Legacy recipes.image_url requires an explicit remote-image migration");
    }
    if (!hasAttachment(row.images)) continue;
    let references: unknown;
    try {
      references = JSON.parse(String(row.images));
    } catch {
      throw new Error(`Legacy recipe ${String(row.id)} images is not valid JSON`);
    }
    if (!Array.isArray(references) || references.some((item) => typeof item !== "string")) {
      throw new Error(`Legacy recipe ${String(row.id)} images is not a string reference list`);
    }
  }
  const externalColumns: [string, string][] = [
    ["warranties", "document_path"],
    ["maintenance_costs", "receipt_path"]
  ];
  for (const [table, column] of externalColumns) {
    if ((snapshots[table]?.rows ?? []).some((row) => hasAttachment(row[column]))) {
      throw new Error(
        `Legacy table ${table} contains external attachment data in ${column}; migrate it with an explicit durable adapter`
      );
    }
  }
}

async function cleanupCreatedBlobs(provider: BlobProvider, stored: StoredAttachment[]): Promise<void> {
  const failures: string[] = [];
  for (const attachment of stored.filter((item) => item.created).reverse()) {
    const removed = await provider.delete(attachment.blobKey);
    if (removed.status !== "ok") failures.push(attachment.blobKey);
  }
  if (failures.length) throw new Error(`Failed to clean up ${failures.length} staged legacy blobs`);
}

async function storeAttachments(
  provider: BlobProvider,
  plans: AttachmentPlan[],
  householdId: string,
  sourceNamespace: string
): Promise<StoredAttachment[]> {
  const stored: StoredAttachment[] = [];
  const namespaceKey = hash(sourceNamespace).slice(0, 24);
  try {
    for (const plan of plans) {
      const sha256 = hashBytes(plan.bytes);
      const identity = `${sourceNamespace}\0${plan.sourceTable}\0${plan.sourceId}\0${plan.dataColumn}`;
      const blobId = `blb_${hash(identity).slice(0, 32)}`;
      const blobKey = `${householdId}/legacy/${namespaceKey}/${plan.sourceTable}/${blobId}`;
      const uploaded = await provider.create(blobKey, plan.bytes);
      if (uploaded.status !== "ok") throw new Error(uploaded.message);
      const attachment: StoredAttachment = {
        ...plan,
        blobId,
        blobKey,
        byteSize: plan.bytes.length,
        sha256,
        created: uploaded.value.created
      };
      stored.push(attachment);
      if (uploaded.value.byteSize !== plan.bytes.length || uploaded.value.sha256 !== sha256) {
        throw new Error(`Legacy blob verification failed for ${plan.sourceTable} row ${plan.sourceId}`);
      }
      const readback = await provider.get(blobKey);
      if (readback.status !== "ok") throw new Error(`Legacy blob readback failed for ${plan.sourceTable} row ${plan.sourceId}`);
      const readbackBytes = Buffer.from(readback.value);
      if (readbackBytes.length !== plan.bytes.length || !readbackBytes.equals(plan.bytes)) {
        throw new Error(`Legacy blob readback mismatch for ${plan.sourceTable} row ${plan.sourceId}`);
      }
    }
    return stored;
  } catch (error) {
    try {
      await cleanupCreatedBlobs(provider, stored);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Legacy blob staging and cleanup failed");
    }
    throw error;
  }
}

function attachmentIdentity(
  plan: AttachmentPlan,
  householdId: string,
  sourceNamespace: string
): { blobId: string; blobKey: string } {
  const identity = `${sourceNamespace}\0${plan.sourceTable}\0${plan.sourceId}\0${plan.dataColumn}`;
  const blobId = `blb_${hash(identity).slice(0, 32)}`;
  const namespaceKey = hash(sourceNamespace).slice(0, 24);
  return {
    blobId,
    blobKey: `${householdId}/legacy/${namespaceKey}/${plan.sourceTable}/${blobId}`
  };
}

async function verifyImportedAttachments(
  target: HearthDatabase,
  provider: BlobProvider,
  plans: AttachmentPlan[],
  householdId: string,
  sourceNamespace: string
): Promise<void> {
  for (const plan of plans) {
    const { blobId, blobKey } = attachmentIdentity(plan, householdId, sourceNamespace);
    const metadata = target.prepare(`
      SELECT blob_key,provider,content_type,byte_size,sha256 FROM blob_metadata
      WHERE id=? AND household_id=?
    `).get(blobId, householdId) as {
      blob_key: string;
      provider: string;
      content_type: string;
      byte_size: number;
      sha256: string;
    } | undefined;
    const expectedHash = hashBytes(plan.bytes);
    if (!metadata
      || metadata.blob_key !== blobKey
      || metadata.provider !== provider.name
      || metadata.content_type !== plan.contentType
      || metadata.byte_size !== plan.bytes.length
      || metadata.sha256 !== expectedHash) {
      throw new Error(`Legacy blob metadata differs for ${plan.sourceTable} row ${plan.sourceId}`);
    }
    const stored = await provider.get(blobKey);
    if (stored.status !== "ok") {
      throw new Error(`Legacy stored blob is unavailable for ${plan.sourceTable} row ${plan.sourceId}`);
    }
    const bytes = Buffer.from(stored.value);
    if (bytes.length !== plan.bytes.length || hashBytes(bytes) !== expectedHash) {
      throw new Error(`Legacy stored blob differs for ${plan.sourceTable} row ${plan.sourceId}`);
    }
    if (plan.link) {
      const link = target.prepare(`SELECT blob_id FROM ${plan.link.targetTable} WHERE id=? AND household_id=?`)
        .get(plan.link.id, householdId) as { blob_id: string } | undefined;
      if (link?.blob_id !== blobId) {
        throw new Error(`Legacy attachment link differs for ${plan.sourceTable} row ${plan.sourceId}`);
      }
    }
  }
}

type UntouchedValue = unknown | ((row: Record<string, unknown>) => unknown);

const domainUpgradeFields: Record<string, Record<string, UntouchedValue>> = {
  home_items: {
    category: "Other", estimated_lifespan_years: null, replacement_cost_cents: null
  },
  maintenance_tasks: {
    task_type: "Scheduled", scheduled_on: null, estimated_duration_hours: null,
    actual_duration_hours: null, next_due_on: null, assigned_to: null, notes: null, ai_generated: 0
  },
  warranties: {
    warranty_type: "Manufacturer", claim_process: null, contact_info: null,
    is_active: 1, ai_analyzed: 0, ai_summary: null
  },
  maintenance_costs: {
    cost_type: "Other", description: null, tax_cents: null,
    warranty_covered: 0, ai_categorized: 0, receipt_blob_id: null
  },
  ai_insights: {
    title: null, confidence_score: null, priority: "normal",
    predicted_on: null, predicted_cost_cents: null, source_data: null
  },
  inventory_categories: { icon: null, color: null, sort_order: 0 },
  inventory_locations: { sort_order: 0 },
  inventory_sub_locations: { sort_order: 0 },
  inventory_items: {
    maintenance_item_id: null, condition: "good", status: "active", brand: null,
    model: null, serial_number: null, barcode: null, sku: null, purchased_from: null,
    purchase_price_cents: null, product_url: null, notes: null, ai_identified: 0
  },
  weather_daily: { weather_code: null, fetched_at: null },
  yard_location: { zip: null, profile_json: null, profile_at: null },
  garden_fields: { sort_order: 0 },
  garden_vegetables: {
    slug: null, latin: null, family: null, emoji: null, sow_start_month: null,
    sow_end_month: null, harvest_start_month: null, harvest_end_month: null,
    spacing_in: null, row_spacing_in: null, depth_in: null, sun: null, water: null,
    days_to_germinate: null, indoor_start_weeks_before_frost: null,
    transplant_weeks_after_frost: null, frost_tolerance: null, companions_json: null,
    antagonists_json: null, is_custom: 0, is_favorite: 0
  },
  garden_beds: {
    shape: "rect", width_in: null, height_in: null, pos_x: 0, pos_y: 0,
    rotation_deg: 0, sun_exposure: null, soil_notes: null
  },
  garden_plantings: {
    variety: null, season_year: null, pos_x: 0, pos_y: 0, sown_at: null,
    transplanted_at: null, first_harvest_at: null, removed_at: null
  },
  garden_tasks: { field_id: null, kind: null, done_at: null, source: "manual" },
  garden_harvests: { weight_oz: null, qty_count: null, quality: null },
  garden_settings: { season_year: null, active_field_id: null, units: null },
  garden_shopping: { season_year: null, vegetable_id: null, quantity_text: null },
  pool_reports: {
    test_date_text: null, report_format: "manual", store_name: null, analyst_name: null,
    test_id: null, pool_volume_gal: null, pool_type: null, water_temperature_f: null,
    filter_type: null, test_kind: null, custom_ideals: 0, summary: null,
    handwritten_notes: null, blob_id: null, file_hash: null, raw_parse_json: null,
    parse_model: null, parse_status: "manual", parse_error: null, verified_at: null
  },
  pool_report_results: {
    parameter_label: (row: Record<string, unknown>) => row.metric, value_text: null, ideal_text: null,
    status: (row: Record<string, unknown>) => {
      const value = typeof row.value === "number" ? row.value : null;
      if (value === null) return null;
      if (typeof row.min_target === "number" && value < row.min_target) return "low";
      if (typeof row.max_target === "number" && value > row.max_target) return "high";
      return "ok";
    },
    position: 0
  },
  pool_report_recommendations: {
    source: null, product: null, instruction: (row: Record<string, unknown>) => row.title, quantity_text: null,
    target: null, timing: null, warnings: null, completed_at: null, position: 0
  },
  pool_chemicals: {
    category: "other", product_name: (row: Record<string, unknown>) => row.name, brand: null,
    active_ingredient: null, active_percent: null, available_chlorine_percent: null,
    net_weight_lbs: null
  },
  pool_insights: {
    payload_json: null, water_health: null, report_count: 0, model: null, generated_at: null
  }
};

const changedMappingFields: Record<string, { field: string; previous: string[] | Transform }[]> = {
  maintenance_tasks: [
    { field: "description", previous: combinedText(["description", "notes"]) }
  ],
  warranties: [
    { field: "notes", previous: combinedText(["notes", "coverage_description", "ai_summary"]) }
  ],
  maintenance_costs: [
    { field: "notes", previous: combinedText(["notes", "description"]) }
  ],
  ai_insights: [
    { field: "status", previous: () => "active" }
  ],
  inventory_items: [
    { field: "description", previous: combinedText(["description", "notes"]) }
  ],
  pool_reports: [
    { field: "notes", previous: combinedText(["notes", "summary", "handwritten_notes"]) }
  ],
  pool_report_results: [
    { field: "unit", previous: (row) => row.unit ?? "" }
  ],
  weather_daily: [
    { field: "conditions", previous: (row: SourceRow) =>
      row.conditions ?? (row.weather_code === null || row.weather_code === undefined ? null : String(row.weather_code)) }
  ],
  garden_beds: [
    { field: "description", previous: value("description", "soil_notes") }
  ],
  garden_plantings: [
    { field: "notes", previous: value("notes", "variety") }
  ],
  garden_shopping: [
    { field: "quantity", previous: value("quantity", "qty") }
  ]
};

function valuesMatch(left: unknown, right: unknown): boolean {
  return left === right || (left === null && right === undefined) || (left === undefined && right === null);
}

function upgradeLegacyDomainFields(
  target: HearthDatabase,
  householdId: string,
  importId: string,
  sourceNamespace: string,
  snapshots: Record<string, { rows: SourceRow[]; count: number; hash: string }>,
  attachmentPlans: AttachmentPlan[]
): void {
  const reportsWithHandwrittenRecommendations = new Set(
    (snapshots.pool_report_recommendations?.rows ?? [])
      .filter((row) => String(row.source).toLowerCase() === "handwritten")
      .map((row) => String(row.report_id))
  );
  target.transaction(() => {
    for (const [sourceTable, changes] of Object.entries(changedMappingFields)) {
      const mapping = legacyMappings[sourceTable];
      if (!mapping) continue;
      for (const sourceRow of snapshots[sourceTable]?.rows ?? []) {
        const id = sourceId(mapping, sourceTable, sourceRow);
        const current = target.prepare(`
          SELECT * FROM ${mapping.target} WHERE id=? AND household_id=?
        `).get(id, householdId) as Record<string, unknown> | undefined;
        if (!current) throw new Error(`Legacy mapping upgrade conflict: ${mapping.target} ${id} is missing`);
        for (const change of changes) {
          const expected = mappedValue(change.previous, sourceRow);
          if (!valuesMatch(current[change.field], expected)) {
            throw new Error(`Legacy mapping upgrade conflict: ${mapping.target} ${id} has newer ${change.field} changes`);
          }
          const currentSpec = mapping.fields[change.field];
          let desired = currentSpec ? mappedValue(currentSpec, sourceRow) : null;
          const fallback = mapping.defaults?.[change.field];
          if ((desired === null || desired === undefined) && fallback !== undefined) {
            desired = typeof fallback === "function" ? fallback(sourceRow) : fallback;
          }
          target.prepare(`
            UPDATE ${mapping.target} SET ${change.field}=? WHERE id=? AND household_id=?
          `).run(desired ?? null, id, householdId);
        }
      }
    }

    for (const [sourceTable, fields] of Object.entries(domainUpgradeFields)) {
      const mapping = legacyMappings[sourceTable];
      if (!mapping) continue;
      const rows = mapLegacyRows(
        sourceTable,
        mapping,
        snapshots[sourceTable]?.rows ?? [],
        reportsWithHandwrittenRecommendations
      );
      const columns = Object.keys(fields);
      for (const row of rows) {
        const current = target.prepare(`
          SELECT * FROM ${mapping.target} WHERE id=? AND household_id=?
        `).get(row.id, householdId) as Record<string, unknown> | undefined;
        if (!current) throw new Error(`Legacy mapping upgrade conflict: ${mapping.target} ${row.id} is missing`);
        for (const [field, expectedValue] of Object.entries(fields)) {
          const expected = typeof expectedValue === "function" ? expectedValue(current) : expectedValue;
          if (!valuesMatch(current[field], expected)) {
            throw new Error(`Legacy mapping upgrade conflict: ${mapping.target} ${row.id} has newer ${field} changes`);
          }
        }
        if (columns.length) {
          target.prepare(`
            UPDATE ${mapping.target} SET ${columns.map((column) => `${column}=?`).join(",")}
            WHERE id=? AND household_id=?
          `).run(
            ...columns.map((column) => {
              if (row.data[column] !== null && row.data[column] !== undefined) return row.data[column];
              const fallback = fields[column];
              return typeof fallback === "function" ? fallback(current) : fallback ?? null;
            }),
            row.id,
            householdId
          );
        }
      }
    }

    for (const plan of attachmentPlans) {
      if (plan.link && ["maintenance_photos", "inventory_item_images"].includes(plan.link.targetTable)) {
        const fields = plan.link.targetTable === "maintenance_photos"
          ? ["photo_category", "taken_at", "ai_analyzed", "ai_description", "ai_tags_json"]
          : ["image_role"];
        const current = target.prepare(`
          SELECT * FROM ${plan.link.targetTable} WHERE id=? AND household_id=?
        `).get(plan.link.id, householdId) as Record<string, unknown> | undefined;
        if (!current) throw new Error(`Legacy mapping upgrade conflict: ${plan.link.targetTable} ${plan.link.id} is missing`);
        const expected = plan.link.targetTable === "maintenance_photos"
          ? { photo_category: "General", taken_at: null, ai_analyzed: 0, ai_description: null, ai_tags_json: null }
          : { image_role: "photo" };
        for (const field of fields) {
          if (!valuesMatch(current[field], expected[field as keyof typeof expected])) {
            throw new Error(`Legacy mapping upgrade conflict: ${plan.link.targetTable} ${plan.link.id} has newer ${field} changes`);
          }
        }
        target.prepare(`
          UPDATE ${plan.link.targetTable} SET ${fields.map((field) => `${field}=?`).join(",")}
          WHERE id=? AND household_id=?
        `).run(...fields.map((field) => plan.link!.data[field] ?? null), plan.link.id, householdId);
      }
      if (plan.sourceTable === "pool_reports") {
        const blobId = attachmentIdentity(plan, householdId, sourceNamespace).blobId;
        const current = target.prepare(`
          SELECT blob_id FROM pool_reports WHERE id=? AND household_id=?
        `).get(plan.sourceId, householdId) as { blob_id: string | null } | undefined;
        if (!current) throw new Error(`Legacy mapping upgrade conflict: pool report ${plan.sourceId} is missing`);
        if (current.blob_id !== null && current.blob_id !== blobId) {
          throw new Error(`Legacy mapping upgrade conflict: pool report ${plan.sourceId} has a newer file`);
        }
        target.prepare("UPDATE pool_reports SET blob_id=? WHERE id=? AND household_id=?")
          .run(blobId, plan.sourceId, householdId);
      }
    }
    target.prepare("UPDATE legacy_imports SET mapping_version=? WHERE id=? AND household_id=?")
      .run(legacyMappingVersion, importId, householdId);
  })();
}

export interface LegacyImportResult {
  status: "imported" | "upgraded" | "no_op";
  importId: string;
  sourceNamespace: string;
  tables: Record<string, { count: number; hash: string }>;
  attachments: { count: number; bytes: number; provider: string | null };
}

export async function importLegacyDatabase(options: {
  target: HearthDatabase;
  sourcePath: string;
  householdId: string;
  sourceNamespace?: string;
  blobProvider?: BlobProvider;
}): Promise<LegacyImportResult> {
  const sourcePath = path.resolve(options.sourcePath);
  const sourceNamespace = options.sourceNamespace ?? `sqlite:${sourcePath}`;
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma("query_only = ON");
    const tables = new Set((source.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
    const snapshots: Record<string, { rows: SourceRow[]; count: number; hash: string }> = {};
    const recognizedTables = [...new Set([...Object.keys(legacyMappings), ...attachmentTables])];
    for (const table of recognizedTables) {
      if (!tables.has(table)) continue;
      const columns = source.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
      if (!columns.length) throw new Error(`Cannot introspect legacy table ${table}`);
      const columnNames = new Set(columns.map((column) => column.name));
      const mapping = legacyMappings[table];
      if (mapping) {
        for (const required of mapping.required ?? []) {
          const spec = mapping.fields[required];
          if (Array.isArray(spec) && !spec.some((candidate) => columnNames.has(candidate))
            && !(required in (mapping.defaults ?? {}))) {
            throw new Error(`Legacy schema drift in ${table}: no recognized source column for ${required}`);
          }
        }
      }
      const rows = source.prepare(`SELECT * FROM "${table}"`).all() as SourceRow[];
      const canonical = canonicalRows(rows);
      snapshots[table] = { rows, count: rows.length, hash: hash(canonical) };
    }
    if (!Object.keys(snapshots).length) throw new Error("Legacy source contains no owned Hearth tables");
    validateExternalAttachments(snapshots);
    const attachmentPlans = buildAttachmentPlans(snapshots);
    const attachmentSummary = {
      count: attachmentPlans.length,
      bytes: attachmentPlans.reduce((total, item) => total + item.bytes.length, 0),
      provider: options.blobProvider?.name ?? null
    };
    if (attachmentPlans.length && !options.blobProvider) {
      throw new Error("Legacy source contains attachments but no durable blob provider is configured");
    }
    const sourceFingerprint = hash(JSON.stringify(Object.entries(snapshots).map(([table, item]) => [table, item.count, item.hash])));
    const existing = options.target.prepare(`
      SELECT id,source_fingerprint,mapping_version FROM legacy_imports WHERE household_id=? AND source_namespace=?
    `).get(options.householdId, sourceNamespace) as {
      id: string;
      source_fingerprint: string;
      mapping_version: number;
    } | undefined;
    if (existing) {
      const reconciled = options.target.prepare(`
        SELECT source_table,row_count,canonical_hash FROM legacy_reconciliation WHERE import_id=? ORDER BY source_table
      `).all(existing.id) as { source_table: string; row_count: number; canonical_hash: string }[];
      const exact = existing.source_fingerprint === sourceFingerprint
        && reconciled.length === Object.keys(snapshots).length
        && reconciled.every((row) => snapshots[row.source_table]?.count === row.row_count
          && snapshots[row.source_table]?.hash === row.canonical_hash);
      if (!exact) throw new Error("Legacy import conflict: source differs from its recorded reconciliation");
      if (attachmentPlans.length) {
        await verifyImportedAttachments(
          options.target,
          options.blobProvider!,
          attachmentPlans,
          options.householdId,
          sourceNamespace
        );
      }
      if (existing.mapping_version > legacyMappingVersion) {
        throw new Error("Legacy import conflict: target mapping is newer than this importer");
      }
      let upgraded = false;
      let mappingVersion = existing.mapping_version;
      if (mappingVersion < recipeMappingVersion) {
        upgradeLegacyRecipeFields(options.target, options.householdId, existing.id, snapshots);
        mappingVersion = recipeMappingVersion;
        upgraded = true;
      }
      if (mappingVersion < legacyMappingVersion) {
        upgradeLegacyDomainFields(
          options.target,
          options.householdId,
          existing.id,
          sourceNamespace,
          snapshots,
          attachmentPlans
        );
        upgraded = true;
      }
      if (upgraded) {
        return {
          status: "upgraded", importId: existing.id, sourceNamespace,
          tables: Object.fromEntries(Object.entries(snapshots).map(([table, item]) => [table, { count: item.count, hash: item.hash }])),
          attachments: attachmentSummary
        };
      }
      return {
        status: "no_op", importId: existing.id, sourceNamespace,
        tables: Object.fromEntries(Object.entries(snapshots).map(([table, item]) => [table, { count: item.count, hash: item.hash }])),
        attachments: attachmentSummary
      };
    }
    if (!options.target.prepare("SELECT 1 FROM households WHERE id=?").get(options.householdId)) {
      throw new Error(`Target household ${options.householdId} does not exist`);
    }
    const reportsWithHandwrittenRecommendations = new Set(
      (snapshots.pool_report_recommendations?.rows ?? [])
        .filter((row) => String(row.source).toLowerCase() === "handwritten")
        .map((row) => String(row.report_id))
    );
    const mappedRows: Record<string, MappedRow[]> = {};
    for (const [table, mapping] of Object.entries(legacyMappings)) {
      const rows = snapshots[table]?.rows ?? [];
      mappedRows[table] = mapLegacyRows(table, mapping, rows, reportsWithHandwrittenRecommendations);
      for (const row of mappedRows[table]) {
        if (options.target.prepare(`SELECT 1 FROM ${mapping.target} WHERE id=?`).get(row.id)) {
          throw new Error(`Legacy import conflict: ${mapping.target} id ${row.id} already exists`);
        }
      }
    }
    for (const plan of attachmentPlans) {
      if (options.target.prepare("SELECT 1 FROM blob_metadata WHERE id=?")
        .get(attachmentIdentity(plan, options.householdId, sourceNamespace).blobId)) {
        throw new Error(`Legacy import conflict: blob metadata already exists for ${plan.sourceTable} row ${plan.sourceId}`);
      }
      if (plan.link && options.target.prepare(`SELECT 1 FROM ${plan.link.targetTable} WHERE id=?`).get(plan.link.id)) {
        throw new Error(`Legacy import conflict: ${plan.link.targetTable} id ${plan.link.id} already exists`);
      }
    }
    const storedAttachments = attachmentPlans.length
      ? await storeAttachments(options.blobProvider!, attachmentPlans, options.householdId, sourceNamespace)
      : [];
    const importId = `lim_${randomUUID().replaceAll("-", "")}`;
    try {
      options.target.transaction(() => {
        const now = new Date().toISOString();
        const insertMap = (
          sourceTable: string,
          sourceIdValue: string,
          targetTable: string,
          targetId: string,
          kind = "legacy"
        ) => {
          options.target.prepare(`
            INSERT INTO legacy_identifier_map
            (id,household_id,source_namespace,source_table,source_id,target_table,target_id,identifier_kind,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)
          `).run(`lid_${randomUUID().replaceAll("-", "")}`, options.householdId, sourceNamespace, sourceTable,
            sourceIdValue, targetTable, targetId, kind, now);
        };
        options.target.prepare(`
          INSERT INTO legacy_imports(
            id,household_id,source_namespace,source_fingerprint,mapping_version,imported_at
          ) VALUES(?,?,?,?,?,?)
        `).run(importId, options.householdId, sourceNamespace, sourceFingerprint, legacyMappingVersion, now);
        for (const attachment of storedAttachments) {
          options.target.prepare(`
            INSERT INTO blob_metadata
            (id,household_id,blob_key,provider,content_type,byte_size,sha256,original_name,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
          `).run(attachment.blobId, options.householdId, attachment.blobKey, options.blobProvider!.name,
            attachment.contentType, attachment.byteSize, attachment.sha256, attachment.originalName,
            attachment.createdAt, attachment.updatedAt);
        }
        for (const [table, mapping] of Object.entries(legacyMappings)) {
          for (const row of mappedRows[table] ?? []) {
            const entries = Object.entries(row.data).filter(([, item]) => item !== null && item !== undefined);
            const columns = entries.map(([column]) => column);
            try {
              options.target.prepare(`
                INSERT INTO ${mapping.target}(id,household_id,created_at,updated_at${columns.length ? `,${columns.join(",")}` : ""})
                VALUES(?,?,?,?${columns.map(() => ",?").join("")})
              `).run(row.id, options.householdId, row.createdAt, row.updatedAt, ...entries.map(([, item]) => item));
            } catch (error) {
              throw new Error(`Legacy ${table} row ${row.id} could not be inserted`, { cause: error });
            }
            insertMap(table, row.id, mapping.target, row.id);
          }
        }
        for (const attachment of storedAttachments) {
          if (attachment.link) {
            const data = { ...attachment.link.data, blob_id: attachment.blobId };
            const entries = Object.entries(data).filter(([, item]) => item !== null && item !== undefined);
            const columns = entries.map(([column]) => column);
            options.target.prepare(`
              INSERT INTO ${attachment.link.targetTable}
              (id,household_id,created_at,updated_at,${columns.join(",")})
              VALUES(?,?,?,?,${columns.map(() => "?").join(",")})
            `).run(attachment.link.id, options.householdId, attachment.createdAt, attachment.updatedAt,
              ...entries.map(([, item]) => item));
            insertMap(attachment.sourceTable, attachment.sourceId,
              attachment.link.targetTable, attachment.link.id);
          }
          if (attachment.sourceTable === "pool_reports") {
            options.target.prepare(`
              UPDATE pool_reports SET blob_id=? WHERE id=? AND household_id=?
            `).run(attachment.blobId, attachment.sourceId, options.householdId);
          }
          insertMap(`${attachment.sourceTable}.${attachment.dataColumn}`, attachment.sourceId,
            "blob_metadata", attachment.blobId, "attachment");
        }
        for (const [table, snapshot] of Object.entries(snapshots)) {
          options.target.prepare(`
            INSERT INTO legacy_reconciliation(id,import_id,source_table,row_count,canonical_hash) VALUES(?,?,?,?,?)
          `).run(`lrc_${randomUUID().replaceAll("-", "")}`, importId, table, snapshot.count, snapshot.hash);
        }
      })();
    } catch (error) {
      try {
        await cleanupCreatedBlobs(options.blobProvider!, storedAttachments);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Legacy database import and blob cleanup failed");
      }
      throw error;
    }
    return {
      status: "imported", importId, sourceNamespace,
      tables: Object.fromEntries(Object.entries(snapshots).map(([table, item]) => [table, { count: item.count, hash: item.hash }])),
      attachments: attachmentSummary
    };
  } finally {
    source.close();
  }
}
