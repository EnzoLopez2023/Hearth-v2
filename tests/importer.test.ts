import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, testRoot } from "./test-utils.js";
import { importLegacyDatabase } from "../src/server/legacy/importer.js";
import type { BlobProvider } from "../src/server/providers/index.js";

const contexts: ReturnType<typeof createTestContext>[] = [];
const sources: string[] = [];
afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const source of sources.splice(0)) fs.rmSync(source, { force: true });
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function sourceFile(name: string): string {
  fs.mkdirSync(testRoot, { recursive: true });
  const file = path.join(testRoot, `${name}-${crypto.randomUUID()}.db`);
  sources.push(file);
  return file;
}

class MemoryBlobProvider implements BlobProvider {
  readonly name = "memory";
  readonly blobs = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array) {
    this.blobs.set(key, Uint8Array.from(bytes));
    return {
      status: "ok" as const,
      value: {
        key,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      }
    };
  }

  async create(key: string, bytes: Uint8Array) {
    const created = !this.blobs.has(key);
    if (created) this.blobs.set(key, Uint8Array.from(bytes));
    return {
      status: "ok" as const,
      value: {
        key,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        created
      }
    };
  }

  async get(key: string) {
    const bytes = this.blobs.get(key);
    return bytes
      ? { status: "ok" as const, value: Uint8Array.from(bytes) }
      : { status: "error" as const, provider: this.name, message: "Blob not found" };
  }

  async delete(key: string) {
    this.blobs.delete(key);
    return { status: "ok" as const, value: undefined };
  }
}

describe("legacy importer", () => {
  it("imports once, preserves ids, reconciles hashes, and makes an exact rerun a no-op", async () => {
    const context = createTestContext("legacy-target");
    contexts.push(context);
    const sourcePath = sourceFile("legacy-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE recipes(
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        cuisine_type TEXT,
        meal_type TEXT,
        prep_time_minutes INTEGER,
        cook_time_minutes INTEGER,
        total_time_minutes INTEGER,
        servings INTEGER,
        difficulty_level TEXT,
        instructions TEXT,
        notes TEXT,
        source_url TEXT,
        is_favorite INTEGER,
        rating REAL,
        dietary_tags TEXT,
        parsed_by_ai INTEGER,
        ai_suggestions TEXT,
        nutrition TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO recipes VALUES(
        42,'Soup','A dependable soup','American','dinner',10,35,0,6,'easy',
        'Roast, blend, and serve.','Double the garlic.','https://example.com/soup',1,4.5,
        '["comfort","soup"]',1,'Use garden tomatoes.',
        '{"calories":220,"protein_g":7,"carbs_g":24,"fat_g":11,"fiber_g":5,"sugar_g":12,"sodium_mg":480}',
        '2020-01-01','2020-01-02'
      );
      CREATE TABLE recipe_ingredients(
        id INTEGER PRIMARY KEY,
        recipe_id INTEGER,
        ingredient_name TEXT,
        quantity REAL,
        unit TEXT,
        notes TEXT,
        position INTEGER
      );
      INSERT INTO recipe_ingredients VALUES(8,42,'Tomatoes',8,'whole','halved',0);
      CREATE TABLE home_items(
        id INTEGER PRIMARY KEY,name TEXT NOT NULL,category TEXT,estimated_lifespan_years INTEGER,
        replacement_cost REAL,qr_identifier TEXT,created_at TEXT,updated_at TEXT
      );
      INSERT INTO home_items VALUES
        (77,'Boiler','HVAC',20,8500,'HEARTH-LEGACY-77','2020-01-01','2020-01-02');
    `);
    source.close();

    const options = {
      target: context.db, sourcePath, householdId: "hsh_dev_hearth", sourceNamespace: "fixture:v1"
    };
    const first = await importLegacyDatabase(options);
    context.db.prepare(`
      UPDATE recipes SET cuisine_type=NULL,meal_type='dinner',total_minutes=NULL,
        difficulty_level='medium',notes=NULL,source_url=NULL,is_favorite=0,rating=NULL,
        parsed_by_ai=0,ai_suggestions=NULL,nutrition_json=NULL
    `).run();
    context.db.prepare("UPDATE recipe_ingredients SET notes=NULL").run();
    context.db.prepare(`
      UPDATE home_items SET category='Other',estimated_lifespan_years=NULL,replacement_cost_cents=NULL
    `).run();
    context.db.prepare("UPDATE legacy_imports SET mapping_version=1 WHERE id=?").run(first.importId);
    const upgraded = await importLegacyDatabase(options);
    const second = await importLegacyDatabase(options);
    expect(first.status).toBe("imported");
    expect(upgraded.status).toBe("upgraded");
    expect(upgraded.importId).toBe(first.importId);
    expect(second.status).toBe("no_op");
    expect(second.importId).toBe(first.importId);
    expect(context.db.prepare("SELECT mapping_version FROM legacy_imports WHERE id=?").pluck().get(first.importId)).toBe(3);
    expect(context.db.prepare(`
      SELECT id,name,cuisine_type,meal_type,total_minutes,difficulty_level,notes,source_url,
        is_favorite,rating,parsed_by_ai,ai_suggestions,tags_json
      FROM recipes
    `).get()).toEqual({
      id: "42",
      name: "Soup",
      cuisine_type: "American",
      meal_type: "dinner",
      total_minutes: null,
      difficulty_level: "easy",
      notes: "Double the garlic.",
      source_url: "https://example.com/soup",
      is_favorite: 1,
      rating: 4.5,
      parsed_by_ai: 1,
      ai_suggestions: "Use garden tomatoes.",
      tags_json: '["comfort","soup"]'
    });
    expect(JSON.parse(context.db.prepare("SELECT nutrition_json FROM recipes").pluck().get() as string)).toEqual({
      calories: 220,
      protein_g: 7,
      carbs_g: 24,
      fat_g: 11,
      fiber_g: 5,
      sugar_g: 12,
      sodium_mg: 480
    });
    expect(context.db.prepare("SELECT name,quantity,unit,notes,position FROM recipe_ingredients").get())
      .toEqual({ name: "Tomatoes", quantity: 8, unit: "whole", notes: "halved", position: 0 });
    expect(context.db.prepare(`
      SELECT category,estimated_lifespan_years,replacement_cost_cents FROM home_items WHERE id='77'
    `).get()).toEqual({ category: "HVAC", estimated_lifespan_years: 20, replacement_cost_cents: 850000 });
    expect(context.db.prepare("SELECT source_id,target_id FROM legacy_identifier_map WHERE source_table='home_items'").get())
      .toEqual({ source_id: "77", target_id: "77" });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_reconciliation WHERE import_id=?").get(first.importId))
      .toEqual({ count: 3 });

    const changed = new Database(sourcePath);
    changed.prepare("UPDATE recipes SET description='Changed' WHERE id=42").run();
    changed.close();
    await expect(importLegacyDatabase(options)).rejects.toThrow(/source differs/);
  });

  it("preserves rich maintenance, inventory, yard, and garden records", async () => {
    const context = createTestContext("legacy-rich-domains");
    contexts.push(context);
    const sourcePath = sourceFile("rich-domain-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE home_items(
        id INTEGER PRIMARY KEY,name TEXT,category TEXT,location TEXT,description TEXT,
        purchase_date TEXT,installation_date TEXT,manufacturer TEXT,model_number TEXT,
        serial_number TEXT,estimated_lifespan_years INTEGER,replacement_cost REAL
      );
      INSERT INTO home_items VALUES
        (1,'Heat pump','HVAC','Attic','Primary system','2024-04-12','2024-04-15',
         'Trane','XV20i','SYNTH-1',18,12500.50);
      CREATE TABLE maintenance_tasks(
        id INTEGER PRIMARY KEY,item_id INTEGER,title TEXT,description TEXT,task_type TEXT,
        priority TEXT,status TEXT,scheduled_date TEXT,due_date TEXT,completed_date TEXT,
        estimated_duration_hours REAL,actual_duration_hours REAL,recurring_interval_days INTEGER,
        next_due_date TEXT,assigned_to TEXT,notes TEXT,ai_generated INTEGER
      );
      INSERT INTO maintenance_tasks VALUES
        (2,1,'Replace filter','Quarterly service','Preventive','High','In Progress',
         '2026-09-01','2026-09-05',NULL,1.5,0.75,90,'2026-12-04','Alex','Use MERV 11',1);
      CREATE TABLE warranties(
        id INTEGER PRIMARY KEY,item_id INTEGER,warranty_type TEXT,provider TEXT,warranty_number TEXT,
        start_date TEXT,end_date TEXT,coverage_description TEXT,claim_process TEXT,contact_info TEXT,
        document_path TEXT,is_active INTEGER,ai_analyzed INTEGER,ai_summary TEXT
      );
      INSERT INTO warranties VALUES
        (3,1,'Manufacturer','Trane','WTY-3','2024-04-15','2034-04-15','Compressor coverage',
         'Call dealer','800-555-0100',NULL,1,1,'Coverage remains active');
      CREATE TABLE maintenance_costs(
        id INTEGER PRIMARY KEY,item_id INTEGER,task_id INTEGER,cost_type TEXT,description TEXT,
        amount REAL,currency TEXT,vendor TEXT,receipt_path TEXT,cost_date TEXT,notes TEXT,
        tax_amount REAL,warranty_covered INTEGER,ai_categorized INTEGER
      );
      INSERT INTO maintenance_costs VALUES
        (4,1,2,'Professional Service','Seasonal inspection',189.25,'USD','Home Air',NULL,
         '2026-08-20','No parts needed',14.25,0,1);
      CREATE TABLE ai_insights(
        id INTEGER PRIMARY KEY,item_id INTEGER,insight_type TEXT,title TEXT,description TEXT,
        confidence_score REAL,priority TEXT,status TEXT,predicted_date TEXT,predicted_cost REAL,
        source_data TEXT
      );
      INSERT INTO ai_insights VALUES
        (5,1,'Replacement Timing','Plan replacement','Efficiency is declining',0.82,'High',
         'Acknowledged','2038-04-01',14000,'{"basis":"age"}');

      CREATE TABLE inventory_categories(
        id INTEGER PRIMARY KEY,name TEXT,icon TEXT,color TEXT,sort_order INTEGER
      );
      INSERT INTO inventory_categories VALUES(10,'Tools','wrench','#884422',2);
      CREATE TABLE inventory_locations(
        id INTEGER PRIMARY KEY,name TEXT,description TEXT,sort_order INTEGER
      );
      INSERT INTO inventory_locations VALUES(11,'Garage','Main storage',1);
      CREATE TABLE inventory_sub_locations(
        id INTEGER PRIMARY KEY,location_id INTEGER,name TEXT,description TEXT,sort_order INTEGER
      );
      INSERT INTO inventory_sub_locations VALUES(12,11,'Workbench','Top drawers',3);
      CREATE TABLE inventory_items(
        id INTEGER PRIMARY KEY,name TEXT,description TEXT,category_id INTEGER,location_id INTEGER,
        sub_location_id INTEGER,maintenance_item_id INTEGER,qty INTEGER,condition TEXT,status TEXT,
        brand TEXT,model TEXT,serial_number TEXT,barcode TEXT,sku TEXT,purchase_date TEXT,
        purchased_from TEXT,purchase_price REAL,current_value REAL,product_url TEXT,notes TEXT,
        ai_identified INTEGER
      );
      INSERT INTO inventory_items VALUES
        (13,'Cordless drill','Brushless drill',10,11,12,1,2,'excellent','active','Makita',
         'XFD14','DRILL-13','BAR-13','SKU-13','2025-03-10','Tool Shop',249.99,210.50,
         'https://example.com/drill','Includes two batteries',1);

      CREATE TABLE weather_daily(
        date TEXT PRIMARY KEY,lat REAL,lon REAL,temp_max_f REAL,temp_min_f REAL,
        precip_in REAL,weather_code INTEGER,fetched_at TEXT
      );
      INSERT INTO weather_daily VALUES('2026-09-01',34.1,-118.2,88,63,0.25,801,'2026-09-01T06:00:00Z');
      CREATE TABLE yard_location(
        id INTEGER PRIMARY KEY,zip TEXT,profile_json TEXT,profile_at TEXT,updated_at TEXT
      );
      INSERT INTO yard_location VALUES
        (1,'90210','{"lat":34.1,"lon":-118.2,"city":"Beverly Hills","zone":"10b"}',
         '2026-08-31T12:00:00Z','2026-08-31T12:00:00Z');

      CREATE TABLE garden_fields(
        id INTEGER PRIMARY KEY,name TEXT,notes TEXT,sort_order INTEGER,created_at TEXT,updated_at TEXT
      );
      INSERT INTO garden_fields VALUES(20,'Kitchen garden','Raised-bed field',1,'2026-01-01','2026-01-01');
      CREATE TABLE garden_vegetables(
        id INTEGER PRIMARY KEY,slug TEXT,name TEXT,latin TEXT,family TEXT,emoji TEXT,
        sow_start_month INTEGER,sow_end_month INTEGER,harvest_start_month INTEGER,
        harvest_end_month INTEGER,spacing_in REAL,row_spacing_in REAL,depth_in REAL,
        sun TEXT,water TEXT,days_to_maturity INTEGER,days_to_germinate INTEGER,
        indoor_start_weeks_before_frost INTEGER,transplant_weeks_after_frost INTEGER,
        frost_tolerance TEXT,companions_json TEXT,antagonists_json TEXT,notes TEXT,
        is_custom INTEGER,is_favorite INTEGER,created_at TEXT,updated_at TEXT
      );
      INSERT INTO garden_vegetables VALUES
        (21,'tomato','Tomato','Solanum lycopersicum','Solanaceae','T',2,4,6,10,24,36,0.25,
         'full','high',72,7,6,2,'tender','["basil"]','["fennel"]','Stake early',0,1,
         '2026-01-01','2026-01-01');
      CREATE TABLE garden_beds(
        id INTEGER PRIMARY KEY,field_id INTEGER,name TEXT,shape TEXT,width_in REAL,height_in REAL,
        pos_x REAL,pos_y REAL,rotation_deg REAL,sun_exposure TEXT,soil_notes TEXT,
        created_at TEXT,updated_at TEXT
      );
      INSERT INTO garden_beds VALUES
        (22,20,'Bed A','rect',96,48,12,18,5,'full','Compost amended','2026-01-01','2026-01-01');
      CREATE TABLE garden_plantings(
        id INTEGER PRIMARY KEY,bed_id INTEGER,vegetable_id INTEGER,variety TEXT,season_year INTEGER,
        pos_x REAL,pos_y REAL,qty INTEGER,status TEXT,sown_at TEXT,transplanted_at TEXT,
        first_harvest_at TEXT,removed_at TEXT,notes TEXT,created_at TEXT,updated_at TEXT
      );
      INSERT INTO garden_plantings VALUES
        (23,22,21,'Sungold',2026,24,12,2,'harvesting','2026-02-20','2026-04-12',
         '2026-06-25',NULL,'North edge','2026-02-20','2026-06-25');
      CREATE TABLE garden_tasks(
        id INTEGER PRIMARY KEY,planting_id INTEGER,field_id INTEGER,due_date TEXT,kind TEXT,
        title TEXT,detail TEXT,done INTEGER,done_at TEXT,source TEXT,created_at TEXT
      );
      INSERT INTO garden_tasks VALUES
        (24,23,20,'2026-09-03','harvest','Pick tomatoes','Harvest before rain',1,
         '2026-09-03T10:00:00Z','auto','2026-08-20');
      CREATE TABLE garden_harvests(
        id INTEGER PRIMARY KEY,planting_id INTEGER,harvest_date TEXT,weight_oz REAL,
        qty_count INTEGER,quality TEXT,notes TEXT,created_at TEXT
      );
      INSERT INTO garden_harvests VALUES
        (25,23,'2026-09-03',38.5,42,'excellent','Peak sweetness','2026-09-03');
      CREATE TABLE garden_settings(
        id INTEGER PRIMARY KEY,season_year INTEGER,active_field_id INTEGER,units TEXT,updated_at TEXT
      );
      INSERT INTO garden_settings VALUES(1,2026,20,'imperial','2026-01-01');
      CREATE TABLE garden_shopping(
        id INTEGER PRIMARY KEY,season_year INTEGER,vegetable_id INTEGER,label TEXT,qty TEXT,
        checked INTEGER,notes TEXT,created_at TEXT
      );
      INSERT INTO garden_shopping VALUES
        (26,2026,21,'Tomato seed','3 packets',0,'Sungold preferred','2026-01-01');
    `);
    source.close();

    const result = await importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:rich-domains"
    });
    expect(result.status).toBe("imported");
    expect(context.db.prepare(`
      SELECT category,estimated_lifespan_years,replacement_cost_cents FROM home_items WHERE id='1'
    `).get()).toEqual({
      category: "HVAC",
      estimated_lifespan_years: 18,
      replacement_cost_cents: 1_250_050
    });
    expect(context.db.prepare(`
      SELECT task_type,scheduled_on,estimated_duration_hours,actual_duration_hours,next_due_on,
        assigned_to,notes,ai_generated FROM maintenance_tasks WHERE id='2'
    `).get()).toEqual({
      task_type: "Preventive",
      scheduled_on: "2026-09-01",
      estimated_duration_hours: 1.5,
      actual_duration_hours: 0.75,
      next_due_on: "2026-12-04",
      assigned_to: "Alex",
      notes: "Use MERV 11",
      ai_generated: 1
    });
    expect(context.db.prepare(`
      SELECT warranty_type,claim_process,contact_info,is_active,ai_analyzed,ai_summary
      FROM warranties WHERE id='3'
    `).get()).toEqual({
      warranty_type: "Manufacturer",
      claim_process: "Call dealer",
      contact_info: "800-555-0100",
      is_active: 1,
      ai_analyzed: 1,
      ai_summary: "Coverage remains active"
    });
    expect(context.db.prepare(`
      SELECT cost_type,description,tax_cents,warranty_covered,ai_categorized
      FROM maintenance_costs WHERE id='4'
    `).get()).toEqual({
      cost_type: "Professional Service",
      description: "Seasonal inspection",
      tax_cents: 1425,
      warranty_covered: 0,
      ai_categorized: 1
    });
    expect(context.db.prepare(`
      SELECT title,confidence_score,priority,predicted_on,predicted_cost_cents,source_data
      FROM ai_insights WHERE id='5'
    `).get()).toEqual({
      title: "Plan replacement",
      confidence_score: 0.82,
      priority: "high",
      predicted_on: "2038-04-01",
      predicted_cost_cents: 1_400_000,
      source_data: '{"basis":"age"}'
    });
    expect(context.db.prepare(`
      SELECT maintenance_item_id,condition,status,brand,model,serial_number,barcode,sku,
        purchased_from,purchase_price_cents,value_cents,product_url,notes,ai_identified,qr_identifier
      FROM inventory_items WHERE id='13'
    `).get()).toEqual({
      maintenance_item_id: "1",
      condition: "excellent",
      status: "active",
      brand: "Makita",
      model: "XFD14",
      serial_number: "DRILL-13",
      barcode: "BAR-13",
      sku: "SKU-13",
      purchased_from: "Tool Shop",
      purchase_price_cents: 24_999,
      value_cents: 21_050,
      product_url: "https://example.com/drill",
      notes: "Includes two batteries",
      ai_identified: 1,
      qr_identifier: "BAR-13"
    });
    expect(context.db.prepare(`
      SELECT zip,profile_json,profile_at,latitude,longitude FROM yard_location WHERE id='1'
    `).get()).toEqual({
      zip: "90210",
      profile_json: '{"city":"Beverly Hills","lat":34.1,"lon":-118.2,"zone":"10b"}',
      profile_at: "2026-08-31T12:00:00.000Z",
      latitude: 34.1,
      longitude: -118.2
    });
    expect(context.db.prepare(`
      SELECT weather_code,fetched_at FROM weather_daily
    `).get()).toEqual({ weather_code: 801, fetched_at: "2026-09-01T06:00:00.000Z" });
    expect(context.db.prepare(`
      SELECT slug,latin,family,emoji,sow_start_month,harvest_end_month,spacing_in,sun,water,
        days_to_germinate,frost_tolerance,companions_json,antagonists_json,is_favorite
      FROM garden_vegetables WHERE id='21'
    `).get()).toEqual({
      slug: "tomato",
      latin: "Solanum lycopersicum",
      family: "Solanaceae",
      emoji: "T",
      sow_start_month: 2,
      harvest_end_month: 10,
      spacing_in: 24,
      sun: "full",
      water: "high",
      days_to_germinate: 7,
      frost_tolerance: "tender",
      companions_json: '["basil"]',
      antagonists_json: '["fennel"]',
      is_favorite: 1
    });
    expect(context.db.prepare(`
      SELECT shape,width_in,height_in,pos_x,pos_y,rotation_deg,sun_exposure,soil_notes
      FROM garden_beds WHERE id='22'
    `).get()).toEqual({
      shape: "rect", width_in: 96, height_in: 48, pos_x: 12, pos_y: 18,
      rotation_deg: 5, sun_exposure: "full", soil_notes: "Compost amended"
    });
    expect(context.db.prepare(`
      SELECT variety,season_year,pos_x,pos_y,sown_at,transplanted_at,first_harvest_at,removed_at
      FROM garden_plantings WHERE id='23'
    `).get()).toEqual({
      variety: "Sungold",
      season_year: 2026,
      pos_x: 24,
      pos_y: 12,
      sown_at: "2026-02-20",
      transplanted_at: "2026-04-12",
      first_harvest_at: "2026-06-25",
      removed_at: null
    });
    expect(context.db.prepare(`
      SELECT field_id,kind,done_at,source FROM garden_tasks WHERE id='24'
    `).get()).toEqual({
      field_id: "20",
      kind: "harvest",
      done_at: "2026-09-03T10:00:00.000Z",
      source: "auto"
    });
    expect(context.db.prepare(`
      SELECT weight_oz,qty_count,quality FROM garden_harvests WHERE id='25'
    `).get()).toEqual({ weight_oz: 38.5, qty_count: 42, quality: "excellent" });
    expect(context.db.prepare(`
      SELECT season_year,active_field_id,units FROM garden_settings WHERE id='1'
    `).get()).toEqual({ season_year: 2026, active_field_id: "20", units: "imperial" });
    expect(context.db.prepare(`
      SELECT season_year,vegetable_id,quantity_text FROM garden_shopping WHERE id='26'
    `).get()).toEqual({ season_year: 2026, vegetable_id: "21", quantity_text: "3 packets" });
  });

  it("upgrades corrected v2 field projections without overwriting newer values", async () => {
    const context = createTestContext("legacy-projection-upgrade");
    contexts.push(context);
    const sourcePath = sourceFile("projection-upgrade-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE ai_insights(
        id INTEGER PRIMARY KEY,item_id INTEGER,insight_type TEXT,title TEXT,description TEXT,
        priority TEXT,status TEXT
      );
      INSERT INTO ai_insights VALUES
        (1,NULL,'Safety Alert','Check valve','A valve needs review','Critical','Dismissed');
      CREATE TABLE weather_daily(
        date TEXT PRIMARY KEY,lat REAL,lon REAL,temp_max_f REAL,temp_min_f REAL,
        precip_in REAL,weather_code INTEGER,fetched_at TEXT
      );
      INSERT INTO weather_daily VALUES
        ('2026-09-01',34.1,-118.2,88,63,0,801,'2026-09-01T06:00:00Z');
      CREATE TABLE garden_vegetables(id INTEGER PRIMARY KEY,name TEXT);
      INSERT INTO garden_vegetables VALUES(2,'Tomato');
      CREATE TABLE garden_shopping(
        id INTEGER PRIMARY KEY,season_year INTEGER,vegetable_id INTEGER,label TEXT,
        qty TEXT,checked INTEGER,notes TEXT
      );
      INSERT INTO garden_shopping VALUES(3,2026,2,'Tomato seed','3 packets',0,'Sungold');
    `);
    source.close();
    const options = {
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:projection-upgrade"
    };
    const imported = await importLegacyDatabase(options);
    expect(imported.status).toBe("imported");
    context.db.exec(`
      UPDATE ai_insights SET
        status='active',title=NULL,confidence_score=NULL,priority='normal',predicted_on=NULL,
        predicted_cost_cents=NULL,source_data=NULL;
      UPDATE weather_daily SET conditions=801,weather_code=NULL,fetched_at=NULL;
      UPDATE garden_shopping SET
        quantity='3 packets',season_year=NULL,vegetable_id=NULL,quantity_text=NULL;
      UPDATE legacy_imports SET mapping_version=2
      WHERE source_namespace='fixture:projection-upgrade';
    `);
    const upgraded = await importLegacyDatabase(options);
    expect(upgraded.status).toBe("upgraded");
    expect(context.db.prepare("SELECT status,title,priority FROM ai_insights WHERE id='1'").get())
      .toEqual({ status: "dismissed", title: "Check valve", priority: "urgent" });
    expect(context.db.prepare("SELECT conditions,weather_code,fetched_at FROM weather_daily").get())
      .toEqual({ conditions: null, weather_code: 801, fetched_at: "2026-09-01T06:00:00.000Z" });
    expect(context.db.prepare(`
      SELECT quantity,season_year,vegetable_id,quantity_text FROM garden_shopping WHERE id='3'
    `).get()).toEqual({
      quantity: null,
      season_year: 2026,
      vegetable_id: "2",
      quantity_text: "3 packets"
    });
  });

  it("rolls back every row when any mapping is invalid", async () => {
    const context = createTestContext("legacy-rollback");
    contexts.push(context);
    const sourcePath = sourceFile("invalid-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE recipes(id INTEGER PRIMARY KEY,title TEXT NOT NULL);
      INSERT INTO recipes VALUES(1,'Valid recipe');
      CREATE TABLE recipe_ingredients(id INTEGER PRIMARY KEY,recipe_id INTEGER,ingredient_name TEXT);
      INSERT INTO recipe_ingredients VALUES(2,1,NULL);
    `);
    source.close();
    await expect(importLegacyDatabase({
      target: context.db, sourcePath, householdId: "hsh_dev_hearth", sourceNamespace: "fixture:invalid"
    })).rejects.toThrow(/missing required mapped field name/);
    expect(context.db.prepare("SELECT COUNT(*) count FROM recipes").get()).toEqual({ count: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_imports").get()).toEqual({ count: 0 });
  });

  it("imports embedded attachments through a durable provider and reconciles their links", async () => {
    const context = createTestContext("legacy-attachments");
    contexts.push(context);
    const sourcePath = sourceFile("attachment-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE recipes(
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        images TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO recipes VALUES(4,'Soup','["/api/recipe-images/8"]','2026-08-28','2026-08-28');
      CREATE TABLE recipe_images(
        id INTEGER PRIMARY KEY,
        recipe_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_data BLOB NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        uploaded_at TEXT
      );
      CREATE TABLE home_items(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
      INSERT INTO home_items VALUES(15,'Boiler');
      CREATE TABLE maintenance_photos(
        id INTEGER PRIMARY KEY,
        item_id INTEGER,
        task_id INTEGER,
        photo_name TEXT NOT NULL,
        photo_data BLOB NOT NULL,
        photo_type TEXT NOT NULL,
        photo_size INTEGER NOT NULL,
        photo_category TEXT,
        description TEXT,
        taken_date TEXT,
        ai_analyzed INTEGER,
        ai_description TEXT,
        ai_tags TEXT,
        created_at TEXT
      );
      CREATE TABLE inventory_items(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
      INSERT INTO inventory_items VALUES(17,'Cordless drill');
      CREATE TABLE inventory_item_images(
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL,
        image_name TEXT NOT NULL,
        image_data BLOB NOT NULL,
        image_type TEXT NOT NULL,
        image_size INTEGER NOT NULL,
        image_role TEXT,
        sort_order INTEGER,
        uploaded_at TEXT
      );
      CREATE TABLE pool_reports(
        id INTEGER PRIMARY KEY,
        test_date TEXT NOT NULL,
        test_date_text TEXT,
        report_format TEXT,
        store_name TEXT,
        analyst_name TEXT,
        test_id TEXT,
        pool_volume_gal INTEGER,
        pool_type TEXT,
        water_temp_f REAL,
        filter_type TEXT,
        test_kind TEXT,
        custom_ideals INTEGER,
        summary TEXT,
        handwritten_notes TEXT,
        file_name TEXT NOT NULL,
        file_data BLOB NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_hash TEXT,
        raw_parse_json TEXT,
        parse_model TEXT,
        parse_status TEXT,
        parse_error TEXT,
        verified_at TEXT
      );
      CREATE TABLE pool_report_results(
        id INTEGER PRIMARY KEY,
        report_id INTEGER NOT NULL,
        parameter TEXT NOT NULL,
        parameter_label TEXT,
        value_num REAL,
        value_text TEXT,
        unit TEXT,
        ideal_text TEXT,
        ideal_min REAL,
        ideal_max REAL,
        status TEXT,
        sort_order INTEGER
      );
      CREATE TABLE pool_report_recommendations(
        id INTEGER PRIMARY KEY,
        report_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        product TEXT,
        instruction TEXT NOT NULL,
        quantity TEXT,
        target TEXT,
        timing TEXT,
        warnings TEXT,
        completed_at TEXT,
        sort_order INTEGER
      );
      INSERT INTO pool_report_recommendations VALUES
        (10,9,'computer','Alkalinity Plus','Printed dose','10 pounds','pool','wait 3 hours','Split large doses',NULL,0),
        (11,9,'handwritten','Granular chlorine','Technician dose','4 ounces','skimmer','at sundown',NULL,NULL,1);
      INSERT INTO pool_report_results VALUES
        (12,9,'free_chlorine','FREE CHLORINE',1.2,'1.2 PPM','ppm','2 TO 4 PPM',2,4,'low',0),
        (13,9,'ph','PH',NULL,'COLOR BLOCK','pH','7.2 TO 7.6',7.2,7.6,'unbalanced',1);
      CREATE TABLE pool_chemicals(
        id INTEGER PRIMARY KEY,
        category TEXT,
        product_name TEXT,
        brand TEXT,
        active_ingredient TEXT,
        active_percent REAL,
        available_chlorine_percent REAL,
        net_weight_lbs REAL,
        notes TEXT
      );
      INSERT INTO pool_chemicals VALUES
        (14,'chlorine_granular','Dry chlorinating granular','Regal','Calcium Hypochlorite',68,65,50,'Keep dry');
      CREATE TABLE pool_insights(
        id INTEGER PRIMARY KEY,
        payload_json TEXT,
        report_count INTEGER,
        model TEXT,
        generated_at TEXT
      );
      INSERT INTO pool_insights VALUES
        (1,'{"water_health":"watch","headline":"Chlorine is trending low"}',4,'synthetic-model','2026-08-28T16:00:00Z');
    `);
    const image = Buffer.from("synthetic image");
    source.prepare("INSERT INTO recipe_images VALUES(?,?,?,?,?,?,?)")
      .run(8, 4, "soup.jpg", image, "image/jpeg", image.length, "2026-08-28");
    const maintenancePhoto = Buffer.from("synthetic maintenance photo");
    source.prepare("INSERT INTO maintenance_photos VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        16, 15, null, "boiler.jpg", maintenancePhoto, "image/jpeg", maintenancePhoto.length,
        "Problem", "Corrosion at valve", "2026-08-27T11:00:00Z", 1,
        "Surface corrosion", '["corrosion","valve"]', "2026-08-27T11:00:00Z"
      );
    const inventoryImage = Buffer.from("synthetic inventory image");
    source.prepare("INSERT INTO inventory_item_images VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        18, 17, "serial.jpg", inventoryImage, "image/jpeg", inventoryImage.length,
        "serial_tag", 2, "2026-08-26T10:00:00Z"
      );
    const report = Buffer.from("synthetic fixture");
    source.prepare(`
      INSERT INTO pool_reports VALUES(
        @id,@test_date,@test_date_text,@report_format,@store_name,@analyst_name,@test_id,
        @pool_volume_gal,@pool_type,@water_temp_f,@filter_type,@test_kind,@custom_ideals,
        @summary,@handwritten_notes,@file_name,@file_data,@file_type,@file_size,@file_hash,
        @raw_parse_json,@parse_model,@parse_status,@parse_error,@verified_at
      )
    `).run({
      id: 9,
      test_date: "2026-08-28T14:30:00.000Z",
      test_date_text: "AUG 28, 2026 - 14:30",
      report_format: "pool360",
      store_name: "Synthetic Pool Store",
      analyst_name: "Test Analyst",
      test_id: "TEST-9",
      pool_volume_gal: 18_000,
      pool_type: "plaster",
      water_temp_f: 82,
      filter_type: "cartridge",
      test_kind: "In-Season",
      custom_ideals: 1,
      summary: "Free chlorine is low.",
      handwritten_notes: "Retest tomorrow.",
      file_name: "synthetic-report.pdf",
      file_data: report,
      file_type: "application/pdf",
      file_size: report.length,
      file_hash: "synthetic-hash",
      raw_parse_json: '{"source":"synthetic"}',
      parse_model: "synthetic-model",
      parse_status: "parsed",
      parse_error: null,
      verified_at: "2026-08-28T15:00:00Z"
    });
    source.close();

    const provider = new MemoryBlobProvider();
    const result = await importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments",
      blobProvider: provider
    });
    context.db.exec(`
      UPDATE pool_reports SET
        test_date_text=NULL,report_format='manual',store_name=NULL,analyst_name=NULL,test_id=NULL,
        pool_volume_gal=NULL,pool_type=NULL,water_temperature_f=NULL,filter_type=NULL,test_kind=NULL,
        custom_ideals=0,notes='Free chlorine is low.\n\nRetest tomorrow.',
        summary=NULL,handwritten_notes=NULL,blob_id=NULL,file_hash=NULL,
        raw_parse_json=NULL,parse_model=NULL,parse_status='manual',parse_error=NULL,verified_at=NULL;
      UPDATE pool_report_results SET
        parameter_label=metric,value_text=NULL,ideal_text=NULL,
        status=CASE
          WHEN min_target IS NOT NULL AND value < min_target THEN 'low'
          WHEN max_target IS NOT NULL AND value > max_target THEN 'high'
          WHEN value IS NOT NULL THEN 'ok'
          ELSE NULL
        END,
        position=0;
      UPDATE pool_report_recommendations SET
        source=NULL,product=NULL,instruction=title,quantity_text=NULL,target=NULL,timing=NULL,
        warnings=NULL,completed_at=NULL,position=0;
      UPDATE pool_chemicals SET
        category='other',product_name=name,brand=NULL,active_ingredient=NULL,active_percent=NULL,
        available_chlorine_percent=NULL,net_weight_lbs=NULL;
      UPDATE pool_insights SET
        payload_json=NULL,water_health=NULL,report_count=0,model=NULL,generated_at=NULL;
      UPDATE maintenance_photos SET
        photo_category='General',taken_at=NULL,ai_analyzed=0,ai_description=NULL,ai_tags_json=NULL;
      UPDATE inventory_item_images SET image_role='photo';
      UPDATE legacy_imports SET mapping_version=2 WHERE source_namespace='fixture:attachments';
    `);
    expect((await importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments",
      blobProvider: provider
    })).status).toBe("upgraded");
    expect(result.attachments).toEqual({
      count: 4,
      bytes: image.length + maintenancePhoto.length + inventoryImage.length + report.length,
      provider: "memory"
    });
    expect(provider.blobs.size).toBe(4);
    expect(context.db.prepare("SELECT recipe_id,position FROM recipe_images WHERE id='8'").get())
      .toEqual({ recipe_id: "4", position: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM blob_metadata").get()).toEqual({ count: 4 });
    expect(context.db.prepare(`
      SELECT home_item_id,photo_category,caption,taken_at,ai_analyzed,ai_description,ai_tags_json
      FROM maintenance_photos WHERE id='16'
    `).get()).toEqual({
      home_item_id: "15",
      photo_category: "Problem",
      caption: "Corrosion at valve",
      taken_at: "2026-08-27T11:00:00.000Z",
      ai_analyzed: 1,
      ai_description: "Surface corrosion",
      ai_tags_json: '["corrosion","valve"]'
    });
    expect(context.db.prepare(`
      SELECT inventory_item_id,image_role,alt_text,position FROM inventory_item_images WHERE id='18'
    `).get()).toEqual({
      inventory_item_id: "17",
      image_role: "serial_tag",
      alt_text: "serial_tag",
      position: 2
    });
    expect(context.db.prepare(`
      SELECT target_table,identifier_kind FROM legacy_identifier_map
      WHERE source_table='pool_reports.file_data' AND source_id='9'
    `).get()).toEqual({ target_table: "blob_metadata", identifier_kind: "attachment" });
    const importedReport = context.db.prepare(`
      SELECT report_format,store_name,analyst_name,test_id,pool_volume_gal,pool_type,
        water_temperature_f,filter_type,test_kind,custom_ideals,summary,handwritten_notes,
        blob_id,file_hash,parse_model,parse_status,verified_at
      FROM pool_reports WHERE id='9'
    `).get() as Record<string, unknown>;
    expect(importedReport).toMatchObject({
      report_format: "pool360",
      store_name: "Synthetic Pool Store",
      analyst_name: "Test Analyst",
      test_id: "TEST-9",
      pool_volume_gal: 18_000,
      pool_type: "plaster",
      water_temperature_f: 82,
      filter_type: "cartridge",
      test_kind: "In-Season",
      custom_ideals: 1,
      summary: "Free chlorine is low.",
      handwritten_notes: "Retest tomorrow.",
      file_hash: "synthetic-hash",
      parse_model: "synthetic-model",
      parse_status: "parsed",
      verified_at: "2026-08-28T15:00:00.000Z"
    });
    expect(importedReport.blob_id).toMatch(/^blb_/);
    expect(context.db.prepare(`
      SELECT metric,parameter_label,value,value_text,ideal_text,status,position
      FROM pool_report_results ORDER BY position
    `).all()).toEqual([
      {
        metric: "free_chlorine",
        parameter_label: "FREE CHLORINE",
        value: 1.2,
        value_text: "1.2 PPM",
        ideal_text: "2 TO 4 PPM",
        status: "low",
        position: 0
      },
      {
        metric: "ph",
        parameter_label: "PH",
        value: null,
        value_text: "COLOR BLOCK",
        ideal_text: "7.2 TO 7.6",
        status: "unbalanced",
        position: 1
      }
    ]);
    expect(context.db.prepare(`
      SELECT id,source,product,quantity_text,target,timing,warnings,status,position
      FROM pool_report_recommendations ORDER BY id
    `).all()).toEqual([
      {
        id: "10",
        source: "computer",
        product: "Alkalinity Plus",
        quantity_text: "10 pounds",
        target: "pool",
        timing: "wait 3 hours",
        warnings: "Split large doses",
        status: "dismissed",
        position: 0
      },
      {
        id: "11",
        source: "handwritten",
        product: "Granular chlorine",
        quantity_text: "4 ounces",
        target: "skimmer",
        timing: "at sundown",
        warnings: null,
        status: "open",
        position: 1
      }
    ]);
    expect(context.db.prepare(`
      SELECT category,product_name,brand,active_ingredient,active_percent,
        available_chlorine_percent,net_weight_lbs
      FROM pool_chemicals WHERE id='14'
    `).get()).toEqual({
      category: "chlorine_granular",
      product_name: "Dry chlorinating granular",
      brand: "Regal",
      active_ingredient: "Calcium Hypochlorite",
      active_percent: 68,
      available_chlorine_percent: 65,
      net_weight_lbs: 50
    });
    expect(context.db.prepare(`
      SELECT water_health,report_count,model,generated_at FROM pool_insights WHERE id='1'
    `).get()).toEqual({
      water_health: "watch",
      report_count: 4,
      model: "synthetic-model",
      generated_at: "2026-08-28T16:00:00.000Z"
    });
    expect((await importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments",
      blobProvider: provider
    })).status).toBe("no_op");

    provider.blobs.clear();
    await expect(importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachments",
      blobProvider: provider
    })).rejects.toThrow(/stored blob is unavailable/);
  });

  it("refuses embedded attachments without a durable provider and leaves no partial rows", async () => {
    const context = createTestContext("legacy-attachment-refusal");
    contexts.push(context);
    const sourcePath = sourceFile("attachment-refusal-source");
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE pool_reports(
        id INTEGER PRIMARY KEY,
        test_date TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_data BLOB NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL
      );
    `);
    const report = Buffer.from("synthetic fixture");
    source.prepare("INSERT INTO pool_reports VALUES(?,?,?,?,?,?)")
      .run(9, "2026-08-28T14:30:00.000Z", "synthetic-report.pdf", report, "application/pdf", report.length);
    source.close();

    await expect(importLegacyDatabase({
      target: context.db,
      sourcePath,
      householdId: "hsh_dev_hearth",
      sourceNamespace: "fixture:attachment-refusal"
    })).rejects.toThrow(/no durable blob provider/);
    expect(context.db.prepare("SELECT COUNT(*) count FROM pool_reports").get()).toEqual({ count: 0 });
    expect(context.db.prepare("SELECT COUNT(*) count FROM legacy_imports").get()).toEqual({ count: 0 });
  });
});
