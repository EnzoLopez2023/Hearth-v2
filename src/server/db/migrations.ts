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
  },
  {
    version: 3,
    name: "index-ai-usage-audit",
    sql: `
CREATE INDEX audit_log_ai_usage
ON audit_log(household_id, user_id, action, created_at);
`
  },
  {
    version: 4,
    name: "restore-owned-domain-fields",
    sql: `
ALTER TABLE home_items ADD COLUMN category TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE home_items ADD COLUMN estimated_lifespan_years INTEGER;
ALTER TABLE home_items ADD COLUMN replacement_cost_cents INTEGER;

ALTER TABLE maintenance_tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'Scheduled';
ALTER TABLE maintenance_tasks ADD COLUMN scheduled_on TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN estimated_duration_hours REAL;
ALTER TABLE maintenance_tasks ADD COLUMN actual_duration_hours REAL;
ALTER TABLE maintenance_tasks ADD COLUMN next_due_on TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN assigned_to TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN notes TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0 CHECK(ai_generated IN (0,1));

ALTER TABLE warranties ADD COLUMN warranty_type TEXT NOT NULL DEFAULT 'Manufacturer';
ALTER TABLE warranties ADD COLUMN claim_process TEXT;
ALTER TABLE warranties ADD COLUMN contact_info TEXT;
ALTER TABLE warranties ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1));
ALTER TABLE warranties ADD COLUMN ai_analyzed INTEGER NOT NULL DEFAULT 0 CHECK(ai_analyzed IN (0,1));
ALTER TABLE warranties ADD COLUMN ai_summary TEXT;

ALTER TABLE maintenance_photos ADD COLUMN photo_category TEXT NOT NULL DEFAULT 'General';
ALTER TABLE maintenance_photos ADD COLUMN taken_at TEXT;
ALTER TABLE maintenance_photos ADD COLUMN ai_analyzed INTEGER NOT NULL DEFAULT 0 CHECK(ai_analyzed IN (0,1));
ALTER TABLE maintenance_photos ADD COLUMN ai_description TEXT;
ALTER TABLE maintenance_photos ADD COLUMN ai_tags_json TEXT;

ALTER TABLE maintenance_costs ADD COLUMN cost_type TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE maintenance_costs ADD COLUMN description TEXT;
ALTER TABLE maintenance_costs ADD COLUMN tax_cents INTEGER;
ALTER TABLE maintenance_costs ADD COLUMN warranty_covered INTEGER NOT NULL DEFAULT 0 CHECK(warranty_covered IN (0,1));
ALTER TABLE maintenance_costs ADD COLUMN ai_categorized INTEGER NOT NULL DEFAULT 0 CHECK(ai_categorized IN (0,1));
ALTER TABLE maintenance_costs ADD COLUMN receipt_blob_id TEXT REFERENCES blob_metadata(id) ON DELETE SET NULL;

ALTER TABLE ai_insights ADD COLUMN title TEXT;
ALTER TABLE ai_insights ADD COLUMN confidence_score REAL;
ALTER TABLE ai_insights ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE ai_insights ADD COLUMN predicted_on TEXT;
ALTER TABLE ai_insights ADD COLUMN predicted_cost_cents INTEGER;
ALTER TABLE ai_insights ADD COLUMN source_data TEXT;

ALTER TABLE inventory_categories ADD COLUMN icon TEXT;
ALTER TABLE inventory_categories ADD COLUMN color TEXT;
ALTER TABLE inventory_categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_locations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_sub_locations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventory_items ADD COLUMN maintenance_item_id TEXT REFERENCES home_items(id) ON DELETE SET NULL;
ALTER TABLE inventory_items ADD COLUMN condition TEXT NOT NULL DEFAULT 'good';
ALTER TABLE inventory_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE inventory_items ADD COLUMN brand TEXT;
ALTER TABLE inventory_items ADD COLUMN model TEXT;
ALTER TABLE inventory_items ADD COLUMN serial_number TEXT;
ALTER TABLE inventory_items ADD COLUMN barcode TEXT;
ALTER TABLE inventory_items ADD COLUMN sku TEXT;
ALTER TABLE inventory_items ADD COLUMN purchased_from TEXT;
ALTER TABLE inventory_items ADD COLUMN purchase_price_cents INTEGER;
ALTER TABLE inventory_items ADD COLUMN product_url TEXT;
ALTER TABLE inventory_items ADD COLUMN notes TEXT;
ALTER TABLE inventory_items ADD COLUMN ai_identified INTEGER NOT NULL DEFAULT 0 CHECK(ai_identified IN (0,1));
ALTER TABLE inventory_item_images ADD COLUMN image_role TEXT NOT NULL DEFAULT 'photo';

ALTER TABLE weather_daily ADD COLUMN weather_code INTEGER;
ALTER TABLE weather_daily ADD COLUMN fetched_at TEXT;
ALTER TABLE yard_location ADD COLUMN zip TEXT;
ALTER TABLE yard_location ADD COLUMN profile_json TEXT;
ALTER TABLE yard_location ADD COLUMN profile_at TEXT;

ALTER TABLE garden_fields ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE garden_vegetables ADD COLUMN slug TEXT;
ALTER TABLE garden_vegetables ADD COLUMN latin TEXT;
ALTER TABLE garden_vegetables ADD COLUMN family TEXT;
ALTER TABLE garden_vegetables ADD COLUMN emoji TEXT;
ALTER TABLE garden_vegetables ADD COLUMN sow_start_month INTEGER;
ALTER TABLE garden_vegetables ADD COLUMN sow_end_month INTEGER;
ALTER TABLE garden_vegetables ADD COLUMN harvest_start_month INTEGER;
ALTER TABLE garden_vegetables ADD COLUMN harvest_end_month INTEGER;
ALTER TABLE garden_vegetables ADD COLUMN spacing_in REAL;
ALTER TABLE garden_vegetables ADD COLUMN row_spacing_in REAL;
ALTER TABLE garden_vegetables ADD COLUMN depth_in REAL;
ALTER TABLE garden_vegetables ADD COLUMN sun TEXT;
ALTER TABLE garden_vegetables ADD COLUMN water TEXT;
ALTER TABLE garden_vegetables ADD COLUMN days_to_germinate INTEGER;
ALTER TABLE garden_vegetables ADD COLUMN indoor_start_weeks_before_frost INTEGER;
ALTER TABLE garden_vegetables ADD COLUMN transplant_weeks_after_frost INTEGER;
ALTER TABLE garden_vegetables ADD COLUMN frost_tolerance TEXT;
ALTER TABLE garden_vegetables ADD COLUMN companions_json TEXT;
ALTER TABLE garden_vegetables ADD COLUMN antagonists_json TEXT;
ALTER TABLE garden_vegetables ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0 CHECK(is_custom IN (0,1));
ALTER TABLE garden_vegetables ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1));

ALTER TABLE garden_beds ADD COLUMN shape TEXT NOT NULL DEFAULT 'rect';
ALTER TABLE garden_beds ADD COLUMN width_in REAL;
ALTER TABLE garden_beds ADD COLUMN height_in REAL;
ALTER TABLE garden_beds ADD COLUMN pos_x REAL NOT NULL DEFAULT 0;
ALTER TABLE garden_beds ADD COLUMN pos_y REAL NOT NULL DEFAULT 0;
ALTER TABLE garden_beds ADD COLUMN rotation_deg REAL NOT NULL DEFAULT 0;
ALTER TABLE garden_beds ADD COLUMN sun_exposure TEXT;
ALTER TABLE garden_beds ADD COLUMN soil_notes TEXT;

ALTER TABLE garden_plantings ADD COLUMN variety TEXT;
ALTER TABLE garden_plantings ADD COLUMN season_year INTEGER;
ALTER TABLE garden_plantings ADD COLUMN pos_x REAL NOT NULL DEFAULT 0;
ALTER TABLE garden_plantings ADD COLUMN pos_y REAL NOT NULL DEFAULT 0;
ALTER TABLE garden_plantings ADD COLUMN sown_at TEXT;
ALTER TABLE garden_plantings ADD COLUMN transplanted_at TEXT;
ALTER TABLE garden_plantings ADD COLUMN first_harvest_at TEXT;
ALTER TABLE garden_plantings ADD COLUMN removed_at TEXT;

ALTER TABLE garden_tasks ADD COLUMN field_id TEXT REFERENCES garden_fields(id) ON DELETE CASCADE;
ALTER TABLE garden_tasks ADD COLUMN kind TEXT;
ALTER TABLE garden_tasks ADD COLUMN done_at TEXT;
ALTER TABLE garden_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE garden_harvests ADD COLUMN weight_oz REAL;
ALTER TABLE garden_harvests ADD COLUMN qty_count INTEGER;
ALTER TABLE garden_harvests ADD COLUMN quality TEXT;

ALTER TABLE garden_settings ADD COLUMN season_year INTEGER;
ALTER TABLE garden_settings ADD COLUMN active_field_id TEXT REFERENCES garden_fields(id) ON DELETE SET NULL;
ALTER TABLE garden_settings ADD COLUMN units TEXT;

ALTER TABLE garden_shopping ADD COLUMN season_year INTEGER;
ALTER TABLE garden_shopping ADD COLUMN vegetable_id TEXT REFERENCES garden_vegetables(id) ON DELETE SET NULL;
ALTER TABLE garden_shopping ADD COLUMN quantity_text TEXT;

ALTER TABLE pool_reports ADD COLUMN test_date_text TEXT;
ALTER TABLE pool_reports ADD COLUMN report_format TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE pool_reports ADD COLUMN store_name TEXT;
ALTER TABLE pool_reports ADD COLUMN analyst_name TEXT;
ALTER TABLE pool_reports ADD COLUMN test_id TEXT;
ALTER TABLE pool_reports ADD COLUMN pool_volume_gal INTEGER;
ALTER TABLE pool_reports ADD COLUMN pool_type TEXT;
ALTER TABLE pool_reports ADD COLUMN water_temperature_f REAL;
ALTER TABLE pool_reports ADD COLUMN filter_type TEXT;
ALTER TABLE pool_reports ADD COLUMN test_kind TEXT;
ALTER TABLE pool_reports ADD COLUMN custom_ideals INTEGER NOT NULL DEFAULT 0 CHECK(custom_ideals IN (0,1));
ALTER TABLE pool_reports ADD COLUMN summary TEXT;
ALTER TABLE pool_reports ADD COLUMN handwritten_notes TEXT;
ALTER TABLE pool_reports ADD COLUMN blob_id TEXT REFERENCES blob_metadata(id) ON DELETE SET NULL;
ALTER TABLE pool_reports ADD COLUMN file_hash TEXT;
ALTER TABLE pool_reports ADD COLUMN raw_parse_json TEXT;
ALTER TABLE pool_reports ADD COLUMN parse_model TEXT;
ALTER TABLE pool_reports ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE pool_reports ADD COLUMN parse_error TEXT;
ALTER TABLE pool_reports ADD COLUMN verified_at TEXT;

ALTER TABLE pool_report_results RENAME TO pool_report_results_before_restore;
CREATE TABLE pool_report_results (
  ${owned},
  report_id TEXT NOT NULL REFERENCES pool_reports(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  parameter_label TEXT,
  value REAL,
  value_text TEXT,
  unit TEXT,
  ideal_text TEXT,
  min_target REAL,
  max_target REAL,
  status TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO pool_report_results(
  id,household_id,created_at,updated_at,report_id,metric,parameter_label,value,value_text,
  unit,ideal_text,min_target,max_target,status,position
)
SELECT id,household_id,created_at,updated_at,report_id,metric,metric,value,NULL,
  unit,NULL,min_target,max_target,
  CASE
    WHEN min_target IS NOT NULL AND value < min_target THEN 'low'
    WHEN max_target IS NOT NULL AND value > max_target THEN 'high'
    WHEN value IS NOT NULL THEN 'ok'
    ELSE NULL
  END,
  0
FROM pool_report_results_before_restore;
DROP TABLE pool_report_results_before_restore;

ALTER TABLE pool_report_recommendations ADD COLUMN source TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN product TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN instruction TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN quantity_text TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN target TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN timing TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN warnings TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN completed_at TEXT;
ALTER TABLE pool_report_recommendations ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE pool_report_recommendations SET instruction=title WHERE instruction IS NULL;

ALTER TABLE pool_chemicals ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE pool_chemicals ADD COLUMN product_name TEXT;
ALTER TABLE pool_chemicals ADD COLUMN brand TEXT;
ALTER TABLE pool_chemicals ADD COLUMN active_ingredient TEXT;
ALTER TABLE pool_chemicals ADD COLUMN active_percent REAL;
ALTER TABLE pool_chemicals ADD COLUMN available_chlorine_percent REAL;
ALTER TABLE pool_chemicals ADD COLUMN net_weight_lbs REAL;
UPDATE pool_chemicals SET product_name=name WHERE product_name IS NULL;

ALTER TABLE pool_insights ADD COLUMN payload_json TEXT;
ALTER TABLE pool_insights ADD COLUMN water_health TEXT;
ALTER TABLE pool_insights ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pool_insights ADD COLUMN model TEXT;
ALTER TABLE pool_insights ADD COLUMN generated_at TEXT;

CREATE UNIQUE INDEX garden_vegetables_household_slug
ON garden_vegetables(household_id, slug) WHERE slug IS NOT NULL;
CREATE INDEX garden_plantings_household_season
ON garden_plantings(household_id, season_year);
CREATE INDEX pool_report_results_report_position
ON pool_report_results(report_id, position);
CREATE INDEX pool_recommendations_report_position
ON pool_report_recommendations(report_id, position);
`
  }
];
