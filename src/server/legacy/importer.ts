import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { HearthDatabase } from "../db/database.js";
import type { BlobProvider } from "../providers/index.js";

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
const fahrenheitToCelsius = (celsius: string, fahrenheit: string): Transform => (row) => {
  if (row[celsius] !== null && row[celsius] !== undefined) return row[celsius];
  return row[fahrenheit] === null || row[fahrenheit] === undefined ? null : (Number(row[fahrenheit]) - 32) * 5 / 9;
};
const jsonRow = (row: SourceRow) => JSON.stringify(normalize(row));
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
    tags_json: ["tags_json", "dietary_tags"]
  }, required: ["name"] },
  recipe_ingredients: { target: "recipe_ingredients", fields: {
    recipe_id: ["recipe_id"], name: ["name", "ingredient_name"], quantity: ["quantity"], unit: ["unit"], position: ["position"]
  }, defaults: { position: 0 }, required: ["recipe_id", "name"] },
  home_items: { target: "home_items", fields: {
    name: ["name"], description: ["description"], manufacturer: ["manufacturer"], model: ["model", "model_number"],
    serial_number: ["serial_number"], purchased_on: dateValue("purchased_on", "purchase_date"),
    installed_on: dateValue("installed_on", "installation_date"), qr_identifier: ["qr_identifier"], location: ["location"]
  }, required: ["name"] },
  maintenance_tasks: { target: "maintenance_tasks", fields: {
    home_item_id: ["home_item_id", "item_id"], title: ["title"], description: combinedText(["description", "notes"]),
    due_on: dateValue("due_on", "due_date", "scheduled_date"), recurrence_days: ["recurrence_days", "recurring_interval_days"],
    status: normalizedStatus("open", { pending: "open", overdue: "open", "in progress": "in_progress", completed: "completed", cancelled: "cancelled" }),
    completed_at: dateTimeValue("completed_at", "completed_date"),
    priority: (row) => ({ low: "low", medium: "normal", high: "high", critical: "urgent" }[String(row.priority ?? "").toLowerCase()] ?? "normal")
  }, required: ["title"] },
  warranties: { target: "warranties", fields: {
    home_item_id: ["home_item_id", "item_id"], provider: ["provider"], policy_number: ["policy_number", "warranty_number"],
    starts_on: dateValue("starts_on", "start_date"), expires_on: dateValue("expires_on", "end_date"),
    notes: combinedText(["notes", "coverage_description", "ai_summary"])
  }, required: ["home_item_id"] },
  maintenance_costs: { target: "maintenance_costs", fields: {
    task_id: ["task_id"], home_item_id: ["home_item_id", "item_id"], amount_cents: (row) =>
      row.amount_cents ?? cents("amount")(row), currency: ["currency"], incurred_on: dateValue("incurred_on", "cost_date"),
    vendor: ["vendor"], notes: combinedText(["notes", "description"])
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
    name: ["name"], description: combinedText(["description", "notes"]), quantity: ["quantity", "qty"],
    low_quantity: ["low_quantity"], unit: ["unit"], expires_on: dateValue("expires_on"), purchased_on: dateValue("purchased_on", "purchase_date"),
    value_cents: (row) => row.value_cents ?? cents("current_value")(row), qr_identifier: value("qr_identifier", "barcode")
  }, defaults: { quantity: 1 }, required: ["name"] },
  pool_reports: { target: "pool_reports", fields: {
    observed_at: dateTimeValue("observed_at", "test_date", "test_date_text"), status: () => "complete",
    notes: combinedText(["notes", "summary", "handwritten_notes"]), water_temperature: value("water_temperature", "water_temp_f")
  }, required: ["observed_at"] },
  pool_report_results: { target: "pool_report_results", fields: {
    report_id: ["report_id"], metric: ["metric", "parameter"], value: ["value", "value_num"], unit: ["unit"],
    min_target: ["min_target", "ideal_min"], max_target: ["max_target", "ideal_max"]
  }, defaults: { unit: "" }, required: ["report_id", "metric", "value"] },
  pool_report_recommendations: { target: "pool_report_recommendations", fields: {
    report_id: ["report_id"], title: value("title", "product", "instruction"),
    detail: labeledText([
      ["Source", "source"], ["", "instruction"], ["Quantity", "quantity"], ["Target", "target"],
      ["Timing", "timing"], ["Warnings", "warnings"]
    ]), priority: () => "normal",
    status: (row) => row.completed_at ? "completed" : "open"
  }, required: ["report_id", "title"] },
  pool_chemicals: { target: "pool_chemicals", fields: {
    name: ["name", "product_name"], quantity: value("quantity", "net_weight_lbs"), unit: ["unit"], low_quantity: ["low_quantity"],
    expires_on: dateValue("expires_on"), notes: ["notes"]
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
    name: value("name", "zip"), description: yardDescription, latitude: yardProfile("latitude", "lat"),
    longitude: yardProfile("longitude", "lon"), area_sq_ft: ["area_sq_ft"], qr_identifier: ["qr_identifier"]
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
    bed_id: ["bed_id"], vegetable_id: ["vegetable_id"], planted_on: dateValue("planted_on", "sown_at", "transplanted_at"),
    expected_harvest_on: dateValue("expected_harvest_on"), quantity: ["quantity", "qty"],
    status: normalizedStatus("planned", { planned: "planned", planted: "planted", growing: "planted", harvesting: "harvesting", finished: "finished", removed: "finished", failed: "failed" }),
    notes: value("notes", "variety")
  }, required: ["bed_id"] },
  garden_tasks: { target: "garden_tasks", fields: {
    bed_id: ["bed_id"], planting_id: ["planting_id"], title: ["title"], due_on: dateValue("due_on", "due_date"),
    status: (row) => row.done ? "completed" : "open", priority: ["priority"], notes: value("notes", "detail")
  }, defaults: { priority: "normal" }, required: ["title"] },
  garden_harvests: { target: "garden_harvests", fields: {
    planting_id: ["planting_id"], harvested_on: dateValue("harvested_on", "harvest_date"),
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
          caption: combinedText(["description", "ai_description"])(row)
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
          position: Number(row.position ?? row.sort_order ?? nextPosition("inventory_item_images", itemId))
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

export interface LegacyImportResult {
  status: "imported" | "no_op";
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
      if (attachmentPlans.length) {
        await verifyImportedAttachments(
          options.target,
          options.blobProvider!,
          attachmentPlans,
          options.householdId,
          sourceNamespace
        );
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
      mappedRows[table] = rows.map((sourceRow) => {
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
          INSERT INTO legacy_imports(id,household_id,source_namespace,source_fingerprint,imported_at) VALUES(?,?,?,?,?)
        `).run(importId, options.householdId, sourceNamespace, sourceFingerprint, now);
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
