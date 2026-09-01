export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const owned = `
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
`;

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial-normalized-schema",
    sql: `
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  oidc_subject TEXT UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE household_memberships (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','member','viewer')),
  created_at TEXT NOT NULL,
  UNIQUE(household_id, user_id)
);
CREATE TABLE household_settings (
  ${owned},
  setting_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  UNIQUE(household_id, setting_key)
);
CREATE TABLE blob_metadata (
  ${owned},
  blob_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  sha256 TEXT NOT NULL,
  original_name TEXT,
  UNIQUE(household_id, blob_key)
);
CREATE TABLE audit_log (
  ${owned},
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT,
  detail_json TEXT
);
CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(household_id, user_id, method, path, idempotency_key)
);
CREATE TABLE legacy_imports (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_namespace TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(household_id, source_namespace)
);
CREATE TABLE legacy_reconciliation (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES legacy_imports(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  canonical_hash TEXT NOT NULL,
  UNIQUE(import_id, source_table)
);
CREATE TABLE legacy_identifier_map (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_namespace TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  identifier_kind TEXT NOT NULL DEFAULT 'legacy',
  created_at TEXT NOT NULL,
  UNIQUE(household_id, source_namespace, source_table, source_id),
  UNIQUE(household_id, target_table, target_id, identifier_kind)
);

CREATE TABLE recipes (${owned}, name TEXT NOT NULL, description TEXT, instructions TEXT, servings INTEGER, prep_minutes INTEGER, cook_minutes INTEGER, tags_json TEXT);
CREATE TABLE recipe_ingredients (${owned}, recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, name TEXT NOT NULL, quantity REAL, unit TEXT, position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE recipe_images (${owned}, recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, blob_id TEXT NOT NULL REFERENCES blob_metadata(id) ON DELETE RESTRICT, alt_text TEXT, position INTEGER NOT NULL DEFAULT 0);

CREATE TABLE home_items (${owned}, name TEXT NOT NULL, description TEXT, manufacturer TEXT, model TEXT, serial_number TEXT, purchased_on TEXT, installed_on TEXT, qr_identifier TEXT, location TEXT, UNIQUE(household_id, qr_identifier));
CREATE TABLE maintenance_tasks (${owned}, home_item_id TEXT REFERENCES home_items(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, due_on TEXT, recurrence_days INTEGER, status TEXT NOT NULL DEFAULT 'open', completed_at TEXT, priority TEXT NOT NULL DEFAULT 'normal');
CREATE TABLE warranties (${owned}, home_item_id TEXT NOT NULL REFERENCES home_items(id) ON DELETE CASCADE, provider TEXT, policy_number TEXT, starts_on TEXT, expires_on TEXT, notes TEXT, blob_id TEXT REFERENCES blob_metadata(id) ON DELETE SET NULL);
CREATE TABLE maintenance_photos (${owned}, task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE CASCADE, home_item_id TEXT REFERENCES home_items(id) ON DELETE CASCADE, blob_id TEXT NOT NULL REFERENCES blob_metadata(id) ON DELETE RESTRICT, caption TEXT);
CREATE TABLE maintenance_costs (${owned}, task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE CASCADE, home_item_id TEXT REFERENCES home_items(id) ON DELETE CASCADE, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', incurred_on TEXT NOT NULL, vendor TEXT, notes TEXT);
CREATE TABLE ai_insights (${owned}, domain TEXT NOT NULL, subject_id TEXT, provider TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');

CREATE TABLE inventory_categories (${owned}, name TEXT NOT NULL, description TEXT, UNIQUE(household_id, name));
CREATE TABLE inventory_locations (${owned}, name TEXT NOT NULL, description TEXT, qr_identifier TEXT, UNIQUE(household_id, qr_identifier));
CREATE TABLE inventory_sub_locations (${owned}, location_id TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, UNIQUE(household_id, location_id, name));
CREATE TABLE inventory_items (${owned}, category_id TEXT REFERENCES inventory_categories(id) ON DELETE SET NULL, location_id TEXT REFERENCES inventory_locations(id) ON DELETE SET NULL, sub_location_id TEXT REFERENCES inventory_sub_locations(id) ON DELETE SET NULL, name TEXT NOT NULL, description TEXT, quantity REAL NOT NULL DEFAULT 1, low_quantity REAL, unit TEXT, expires_on TEXT, purchased_on TEXT, value_cents INTEGER, qr_identifier TEXT, UNIQUE(household_id, qr_identifier));
CREATE TABLE inventory_item_images (${owned}, inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE, blob_id TEXT NOT NULL REFERENCES blob_metadata(id) ON DELETE RESTRICT, alt_text TEXT, position INTEGER NOT NULL DEFAULT 0);

CREATE TABLE pool_reports (${owned}, observed_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', notes TEXT, water_temperature REAL);
CREATE TABLE pool_report_results (${owned}, report_id TEXT NOT NULL REFERENCES pool_reports(id) ON DELETE CASCADE, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, min_target REAL, max_target REAL);
CREATE TABLE pool_report_recommendations (${owned}, report_id TEXT NOT NULL REFERENCES pool_reports(id) ON DELETE CASCADE, title TEXT NOT NULL, detail TEXT, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open');
CREATE TABLE pool_chemicals (${owned}, name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL, low_quantity REAL, expires_on TEXT, notes TEXT);
CREATE TABLE pool_insights (${owned}, report_id TEXT REFERENCES pool_reports(id) ON DELETE CASCADE, provider TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');

CREATE TABLE weather_daily (${owned}, observed_on TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, high_c REAL, low_c REAL, precipitation_mm REAL, conditions TEXT, provider TEXT NOT NULL, UNIQUE(household_id, observed_on, latitude, longitude));
CREATE TABLE yard_location (${owned}, name TEXT NOT NULL, description TEXT, latitude REAL, longitude REAL, area_sq_ft REAL, qr_identifier TEXT, UNIQUE(household_id, qr_identifier));
CREATE TABLE yard_tasks (${owned}, yard_location_id TEXT REFERENCES yard_location(id) ON DELETE CASCADE, title TEXT NOT NULL, due_on TEXT, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', notes TEXT);

CREATE TABLE garden_fields (${owned}, yard_location_id TEXT REFERENCES yard_location(id) ON DELETE SET NULL, name TEXT NOT NULL, description TEXT);
CREATE TABLE garden_vegetables (${owned}, name TEXT NOT NULL, variety TEXT, days_to_maturity INTEGER, notes TEXT);
CREATE TABLE garden_beds (${owned}, field_id TEXT REFERENCES garden_fields(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, area_sq_ft REAL, qr_identifier TEXT, UNIQUE(household_id, qr_identifier));
CREATE TABLE garden_plantings (${owned}, bed_id TEXT NOT NULL REFERENCES garden_beds(id) ON DELETE CASCADE, vegetable_id TEXT REFERENCES garden_vegetables(id) ON DELETE SET NULL, planted_on TEXT, expected_harvest_on TEXT, quantity INTEGER, status TEXT NOT NULL DEFAULT 'planned', notes TEXT);
CREATE TABLE garden_tasks (${owned}, bed_id TEXT REFERENCES garden_beds(id) ON DELETE CASCADE, planting_id TEXT REFERENCES garden_plantings(id) ON DELETE CASCADE, title TEXT NOT NULL, due_on TEXT, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', notes TEXT);
CREATE TABLE garden_harvests (${owned}, planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE, harvested_on TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, notes TEXT);
CREATE TABLE garden_settings (${owned}, setting_key TEXT NOT NULL, value_json TEXT NOT NULL, UNIQUE(household_id, setting_key));
CREATE TABLE garden_shopping (${owned}, planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL, name TEXT NOT NULL, quantity REAL, unit TEXT, status TEXT NOT NULL DEFAULT 'needed', notes TEXT);

CREATE INDEX maintenance_tasks_household_due ON maintenance_tasks(household_id, due_on, status);
CREATE INDEX inventory_items_household_expiry ON inventory_items(household_id, expires_on);
CREATE INDEX warranties_household_expiry ON warranties(household_id, expires_on);
CREATE INDEX garden_tasks_household_due ON garden_tasks(household_id, due_on, status);
CREATE INDEX yard_tasks_household_due ON yard_tasks(household_id, due_on, status);
CREATE INDEX legacy_map_lookup ON legacy_identifier_map(household_id, target_table, target_id);
`
  },
  {
    version: 2,
    name: "restore-recipe-manager-fields",
    sql: `
ALTER TABLE recipes ADD COLUMN cuisine_type TEXT;
ALTER TABLE recipes ADD COLUMN meal_type TEXT NOT NULL DEFAULT 'dinner';
ALTER TABLE recipes ADD COLUMN total_minutes INTEGER;
ALTER TABLE recipes ADD COLUMN difficulty_level TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE recipes ADD COLUMN notes TEXT;
ALTER TABLE recipes ADD COLUMN source_url TEXT;
ALTER TABLE recipes ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1));
ALTER TABLE recipes ADD COLUMN rating REAL;
ALTER TABLE recipes ADD COLUMN parsed_by_ai INTEGER NOT NULL DEFAULT 0 CHECK(parsed_by_ai IN (0,1));
ALTER TABLE recipes ADD COLUMN ai_suggestions TEXT;
ALTER TABLE recipes ADD COLUMN nutrition_json TEXT;
ALTER TABLE recipe_ingredients ADD COLUMN notes TEXT;
ALTER TABLE legacy_imports ADD COLUMN mapping_version INTEGER NOT NULL DEFAULT 1;

UPDATE recipes
SET tags_json = CASE
  WHEN json_valid(tags_json) = 0 THEN json_array(tags_json)
  WHEN json_type(tags_json) <> 'array' THEN json_array(tags_json)
  ELSE tags_json
END
WHERE tags_json IS NOT NULL;

CREATE INDEX recipes_household_created ON recipes(household_id, created_at DESC);
CREATE INDEX recipes_household_meal_type ON recipes(household_id, meal_type);
CREATE INDEX recipes_household_favorite ON recipes(household_id, is_favorite);
CREATE INDEX recipe_ingredients_recipe_position ON recipe_ingredients(recipe_id, position);
`
  }
];
