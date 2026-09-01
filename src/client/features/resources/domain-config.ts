import { Archive, BookOpen, Sprout, Trees, Waves, Wrench, type LucideIcon } from "lucide-react";

export interface FieldConfig {
  key: string;
  label: string;
  type?: "text" | "textarea" | "date" | "datetime-local" | "number" | "select" | "checkbox" | "json" | "url" | "blob";
  required?: boolean;
  step?: string;
  options?: string[];
  relation?: { path: string; labelKey: string };
  help?: string;
  accept?: string;
  defaultChecked?: boolean;
}

export interface ResourceConfig {
  slug: string;
  label: string;
  singular: string;
  endpoint: string;
  fields: FieldConfig[];
  columns: {
    key: string;
    label: string;
    fallbackKey?: string;
    format?: "date" | "money" | "status" | "quantity" | "boolean" | "blob";
  }[];
}

export interface DomainConfig {
  slug: string;
  label: string;
  coordinate: string;
  description: string;
  heroTitle: string;
  heroAccent?: string;
  icon: LucideIcon;
  resources: ResourceConfig[];
}

const text = (key: string, label: string, required = false, help?: string): FieldConfig =>
  help ? { key, label, required, help } : { key, label, required };
const area = (key: string, label: string, required = false): FieldConfig => ({ key, label, type: "textarea", required });
const date = (key: string, label: string, required = false): FieldConfig => ({ key, label, type: "date", required });
const number = (key: string, label: string, required = false, step = "0.01"): FieldConfig =>
  ({ key, label, type: "number", required, step });
const select = (key: string, label: string, options: string[]): FieldConfig =>
  ({ key, label, type: "select", options });
const checkbox = (key: string, label: string, defaultChecked = false): FieldConfig =>
  ({ key, label, type: "checkbox", defaultChecked });
const json = (key: string, label: string): FieldConfig => ({ key, label, type: "json" });
const url = (key: string, label: string): FieldConfig => ({ key, label, type: "url" });
const blob = (key: string, label: string, required = false, accept?: string): FieldConfig => ({
  key, label, type: "blob", required, ...(accept ? { accept } : {})
});
const relation = (
  key: string,
  label: string,
  path: string,
  labelKey = "name",
  required = false
): FieldConfig => ({ key, label, required, type: "select", relation: { path, labelKey } });
const column = (key: string, label: string, format?: "date" | "money" | "status" | "quantity" | "boolean" | "blob") =>
  format ? { key, label, format } : { key, label };
const states = ["open", "in_progress", "completed", "cancelled"];
const priorities = ["low", "normal", "high", "urgent"];

export const domains: DomainConfig[] = [
  {
    slug: "maintenance",
    label: "Home maintenance",
    coordinate: "H–01",
    description: "Assets, service obligations, warranties, costs, and evidence.",
    heroTitle: "Keep your household humming",
    heroAccent: "household",
    icon: Wrench,
    resources: [
      {
        slug: "items", label: "Home items", singular: "home item", endpoint: "/api/maintenance/items",
        fields: [
          text("name", "Item name", true),
          select("category", "Category", ["HVAC", "Plumbing", "Electrical", "Appliances", "Exterior", "Interior", "Flooring", "Security", "Landscaping", "Other"]),
          text("location", "Location"), text("manufacturer", "Manufacturer"),
          text("model", "Model"), text("serial_number", "Serial number"), date("purchased_on", "Purchased"),
          date("installed_on", "Installed"), text("qr_identifier", "HEARTH QR identifier", false, "Preserve the exact printed identifier."),
          number("estimated_lifespan_years", "Estimated lifespan (years)", false, "1"),
          number("replacement_cost_cents", "Replacement cost (cents)", false, "1"),
          area("description", "Description")
        ],
        columns: [column("name", "Item"), column("category", "Category"), column("location", "Place"), column("manufacturer", "Maker")]
      },
      {
        slug: "tasks", label: "Service ledger", singular: "maintenance task", endpoint: "/api/maintenance/tasks",
        fields: [
          text("title", "Work to do", true), relation("home_item_id", "Home item", "/api/maintenance/items"),
          select("task_type", "Task type", ["Scheduled", "Emergency", "Preventive", "Inspection", "Repair", "Replacement"]),
          date("scheduled_on", "Scheduled"), date("due_on", "Due"), date("next_due_on", "Next due"),
          { key: "completed_at", label: "Completed at", type: "datetime-local" },
          select("priority", "Priority", priorities), select("status", "Status", states),
          number("recurrence_days", "Repeat every (days)", false, "1"),
          number("estimated_duration_hours", "Estimated hours"), number("actual_duration_hours", "Actual hours"),
          text("assigned_to", "Assigned to"), checkbox("ai_generated", "AI generated"),
          area("description", "Description"), area("notes", "Work notes")
        ],
        columns: [column("title", "Obligation"), column("due_on", "Due", "date"), column("priority", "Priority", "status"), column("status", "State", "status")]
      },
      {
        slug: "warranties", label: "Warranties", singular: "warranty", endpoint: "/api/maintenance/warranties",
        fields: [
          relation("home_item_id", "Home item", "/api/maintenance/items", "name", true),
          select("warranty_type", "Warranty type", ["Manufacturer", "Extended", "Service Plan", "Insurance"]),
          text("provider", "Provider"), text("policy_number", "Policy number"), date("starts_on", "Starts"),
          date("expires_on", "Expires"), checkbox("is_active", "Active", true), checkbox("ai_analyzed", "AI analyzed"),
          blob("blob_id", "Warranty document", false, "application/pdf,image/*"),
          area("notes", "Coverage notes"), area("claim_process", "Claim process"),
          area("contact_info", "Contact information"), area("ai_summary", "AI summary")
        ],
        columns: [column("provider", "Provider"), column("warranty_type", "Type"), column("expires_on", "Expires", "date"), column("is_active", "Active", "boolean")]
      },
      {
        slug: "costs", label: "Costs", singular: "maintenance cost", endpoint: "/api/maintenance/costs",
        fields: [
          relation("home_item_id", "Home item", "/api/maintenance/items"),
          relation("task_id", "Service task", "/api/maintenance/tasks", "title"),
          select("cost_type", "Cost type", ["Labor", "Materials", "Tools", "Professional Service", "Parts", "Emergency", "Other"]),
          number("amount_cents", "Amount in cents", true, "1"), number("tax_cents", "Tax in cents", false, "1"),
          text("currency", "Currency", false, "Three-letter code, for example USD."),
          date("incurred_on", "Date", true), text("vendor", "Vendor"),
          checkbox("warranty_covered", "Covered by warranty"), checkbox("ai_categorized", "AI categorized"),
          blob("receipt_blob_id", "Receipt", false, "application/pdf,image/*"),
          area("description", "Description"), area("notes", "Notes")
        ],
        columns: [column("incurred_on", "Date", "date"), column("cost_type", "Type"), column("vendor", "Vendor"), column("amount_cents", "Amount", "money")]
      },
      {
        slug: "photos", label: "Photos", singular: "maintenance photo", endpoint: "/api/maintenance/photos",
        fields: [
          relation("home_item_id", "Home item", "/api/maintenance/items"),
          relation("task_id", "Service task", "/api/maintenance/tasks", "title"),
          blob("blob_id", "Photo", true, "image/*"),
          select("photo_category", "Category", ["Before", "After", "During", "Problem", "Solution", "Documentation", "General"]),
          { key: "taken_at", label: "Taken at", type: "datetime-local" },
          checkbox("ai_analyzed", "AI analyzed"), area("caption", "Caption"),
          area("ai_description", "AI description"), json("ai_tags_json", "AI tags JSON")
        ],
        columns: [column("taken_at", "Taken", "date"), column("photo_category", "Category"), column("caption", "Caption"), column("blob_id", "File", "blob")]
      },
      {
        slug: "insights", label: "Insights", singular: "maintenance insight", endpoint: "/api/maintenance/insights",
        fields: [
          { key: "domain", label: "Domain", type: "select", options: ["maintenance", "inventory", "yard", "garden", "pool", "recipes"], required: true },
          text("subject_id", "Subject ID"), text("provider", "Provider", true), text("kind", "Insight type", true),
          text("title", "Title"), number("confidence_score", "Confidence", false, "0.01"),
          select("priority", "Priority", priorities), select("status", "Status", ["active", "dismissed", "acted_on"]),
          date("predicted_on", "Predicted date"), number("predicted_cost_cents", "Predicted cost (cents)", false, "1"),
          area("content", "Insight", true), json("source_data", "Source data JSON")
        ],
        columns: [column("title", "Insight"), column("kind", "Type"), column("priority", "Priority", "status"), column("status", "State", "status")]
      }
    ]
  },
  {
    slug: "inventory",
    label: "Home inventory",
    coordinate: "H–02",
    description: "What the household owns, where it lives, and when it needs attention.",
    heroTitle: "Everything you own",
    heroAccent: "own",
    icon: Archive,
    resources: [
      {
        slug: "items", label: "Inventory", singular: "inventory item", endpoint: "/api/inventory/items",
        fields: [
          text("name", "Item name", true), relation("category_id", "Category", "/api/inventory/categories"),
          relation("location_id", "Location", "/api/inventory/locations"),
          relation("sub_location_id", "Sub-location", "/api/inventory/sub-locations"),
          relation("maintenance_item_id", "Maintenance item", "/api/maintenance/items"),
          number("quantity", "Quantity"), number("low_quantity", "Low at"), text("unit", "Unit"),
          select("condition", "Condition", ["excellent", "good", "fair", "poor", "broken"]),
          select("status", "Status", ["active", "stored", "loaned", "sold", "discarded", "lost"]),
          text("brand", "Brand"), text("model", "Model"), text("serial_number", "Serial number"),
          text("barcode", "Barcode"), text("sku", "SKU"), text("qr_identifier", "HEARTH QR identifier"),
          date("expires_on", "Expires"), date("purchased_on", "Purchased"), text("purchased_from", "Purchased from"),
          number("purchase_price_cents", "Purchase price (cents)", false, "1"),
          number("value_cents", "Current value (cents)", false, "1"), url("product_url", "Product URL"),
          checkbox("ai_identified", "AI identified"), area("description", "Description"), area("notes", "Notes")
        ],
        columns: [column("name", "Item"), column("quantity", "On hand", "quantity"), column("condition", "Condition", "status"), column("status", "State", "status")]
      },
      {
        slug: "categories", label: "Categories", singular: "category", endpoint: "/api/inventory/categories",
        fields: [
          text("name", "Category name", true), text("icon", "Icon"), text("color", "Color"),
          number("sort_order", "Sort order", false, "1"), area("description", "Description")
        ],
        columns: [column("name", "Category"), column("icon", "Icon"), column("color", "Color"), column("sort_order", "Order")]
      },
      {
        slug: "locations", label: "Locations", singular: "location", endpoint: "/api/inventory/locations",
        fields: [
          text("name", "Location name", true), text("qr_identifier", "HEARTH QR identifier"),
          number("sort_order", "Sort order", false, "1"), area("description", "Description")
        ],
        columns: [column("name", "Location"), column("qr_identifier", "QR"), column("sort_order", "Order"), column("description", "Description")]
      },
      {
        slug: "sub-locations", label: "Sub-locations", singular: "sub-location", endpoint: "/api/inventory/sub-locations",
        fields: [
          relation("location_id", "Parent location", "/api/inventory/locations", "name", true),
          text("name", "Sub-location name", true), number("sort_order", "Sort order", false, "1"),
          area("description", "Description")
        ],
        columns: [column("name", "Sub-location"), column("location_id", "Parent"), column("sort_order", "Order"), column("description", "Description")]
      },
      {
        slug: "images", label: "Images", singular: "inventory image", endpoint: "/api/inventory/images",
        fields: [
          relation("inventory_item_id", "Inventory item", "/api/inventory/items", "name", true),
          blob("blob_id", "Image or document", true, "image/*,application/pdf"),
          select("image_role", "Role", ["photo", "receipt", "serial_tag", "documentation"]),
          number("position", "Order", false, "1"), text("alt_text", "Description")
        ],
        columns: [column("inventory_item_id", "Item"), column("image_role", "Role"), column("alt_text", "Description"), column("blob_id", "File", "blob")]
      }
    ]
  },
  {
    slug: "yard",
    label: "Yard maintenance",
    coordinate: "P–01",
    description: "Mapped exterior areas, recurring work, and recorded weather evidence.",
    heroTitle: "Tend your yard",
    heroAccent: "yard",
    icon: Trees,
    resources: [
      {
        slug: "locations", label: "Yard map", singular: "yard location", endpoint: "/api/yard/locations",
        fields: [
          text("name", "Area name", true), number("area_sq_ft", "Area (sq ft)"),
          number("latitude", "Latitude", false, "any"), number("longitude", "Longitude", false, "any"),
          text("zip", "ZIP code"), { key: "profile_at", label: "Profile updated", type: "datetime-local" },
          text("qr_identifier", "HEARTH QR identifier"), area("description", "Field notes"),
          json("profile_json", "Climate, soil, and pest profile JSON")
        ],
        columns: [column("name", "Area"), column("zip", "ZIP"), column("area_sq_ft", "Sq ft", "quantity"), column("profile_at", "Profile date", "date")]
      },
      {
        slug: "tasks", label: "Yard work", singular: "yard task", endpoint: "/api/yard/tasks",
        fields: [
          text("title", "Work to do", true), relation("yard_location_id", "Area", "/api/yard/locations"),
          date("due_on", "Due"), select("priority", "Priority", priorities), select("status", "Status", states),
          area("notes", "Notes")
        ],
        columns: [column("title", "Work"), column("due_on", "Due", "date"), column("priority", "Priority", "status"), column("status", "State", "status")]
      },
      {
        slug: "weather", label: "Weather record", singular: "weather day", endpoint: "/api/yard/weather",
        fields: [
          date("observed_on", "Date", true), number("latitude", "Latitude", true, "any"),
          number("longitude", "Longitude", true, "any"), number("high_c", "High °C"),
          number("low_c", "Low °C"), number("precipitation_mm", "Precipitation (mm)"),
          number("weather_code", "Weather code", false, "1"), text("conditions", "Conditions"),
          text("provider", "Source", true), { key: "fetched_at", label: "Fetched at", type: "datetime-local" }
        ],
        columns: [column("observed_on", "Date", "date"), column("conditions", "Conditions"), column("high_c", "High °C"), column("precipitation_mm", "Rain mm")]
      }
    ]
  },
  {
    slug: "garden",
    label: "Garden",
    coordinate: "P–02",
    description: "Beds, plantings, tasks, harvest evidence, and shopping needs.",
    heroTitle: "Garden Planner",
    heroAccent: "Planner",
    icon: Sprout,
    resources: [
      {
        slug: "beds", label: "Beds", singular: "garden bed", endpoint: "/api/garden/beds",
        fields: [
          text("name", "Bed name", true), relation("field_id", "Field", "/api/garden/fields"),
          select("shape", "Shape", ["rect", "raised", "poly"]), number("width_in", "Width (in)"),
          number("height_in", "Height (in)"), number("pos_x", "Canvas X", false, "any"),
          number("pos_y", "Canvas Y", false, "any"), number("rotation_deg", "Rotation (degrees)", false, "any"),
          number("area_sq_ft", "Area (sq ft)"), text("sun_exposure", "Sun exposure"),
          text("qr_identifier", "HEARTH QR identifier"), area("description", "Bed notes"), area("soil_notes", "Soil notes")
        ],
        columns: [column("name", "Bed"), column("width_in", "Width in"), column("height_in", "Height in"), column("sun_exposure", "Sun")]
      },
      {
        slug: "plantings", label: "Plantings", singular: "planting", endpoint: "/api/garden/plantings",
        fields: [
          relation("bed_id", "Bed", "/api/garden/beds", "name", true),
          relation("vegetable_id", "Crop", "/api/garden/vegetables"),
          text("variety", "Planted variety"), number("season_year", "Season year", false, "1"),
          number("pos_x", "Canvas X", false, "any"), number("pos_y", "Canvas Y", false, "any"),
          date("sown_at", "Sown"), date("transplanted_at", "Transplanted"),
          date("first_harvest_at", "First harvest"), date("removed_at", "Removed"),
          date("planted_on", "Planted"), date("expected_harvest_on", "Expected harvest"),
          number("quantity", "Count", false, "1"),
          select("status", "Status", ["planned", "planted", "harvesting", "finished", "failed"]), area("notes", "Notes")
        ],
        columns: [column("season_year", "Season"), column("variety", "Variety"), column("status", "State", "status"), column("quantity", "Count")]
      },
      {
        slug: "tasks", label: "Garden work", singular: "garden task", endpoint: "/api/garden/tasks",
        fields: [
          text("title", "Work to do", true), relation("bed_id", "Bed", "/api/garden/beds"),
          relation("planting_id", "Planting", "/api/garden/plantings", "id"), date("due_on", "Due"),
          relation("field_id", "Field", "/api/garden/fields"),
          select("kind", "Task kind", ["sow_indoor", "sow_direct", "transplant", "harvest", "custom"]),
          select("source", "Source", ["auto", "manual"]), select("priority", "Priority", priorities),
          select("status", "Status", states), { key: "done_at", label: "Completed at", type: "datetime-local" },
          area("notes", "Notes")
        ],
        columns: [column("title", "Work"), column("due_on", "Due", "date"), column("priority", "Priority", "status"), column("status", "State", "status")]
      },
      {
        slug: "shopping", label: "Shopping", singular: "shopping item", endpoint: "/api/garden/shopping",
        fields: [
          text("name", "Need", true), number("season_year", "Season year", false, "1"),
          relation("planting_id", "Planting", "/api/garden/plantings", "id"),
          relation("vegetable_id", "Crop", "/api/garden/vegetables"),
          number("quantity", "Quantity"), text("quantity_text", "Original quantity"), text("unit", "Unit"),
          select("status", "Status", ["needed", "purchased", "cancelled"]), area("notes", "Notes")
        ],
        columns: [column("name", "Need"), column("season_year", "Season"), column("quantity_text", "Quantity"), column("status", "State", "status")]
      },
      {
        slug: "fields", label: "Fields", singular: "garden field", endpoint: "/api/garden/fields",
        fields: [
          relation("yard_location_id", "Yard area", "/api/yard/locations"), text("name", "Field name", true),
          number("sort_order", "Sort order", false, "1"), area("description", "Description")
        ],
        columns: [column("name", "Field"), column("sort_order", "Order"), column("description", "Description")]
      },
      {
        slug: "vegetables", label: "Crop catalog", singular: "crop", endpoint: "/api/garden/vegetables",
        fields: [
          text("name", "Crop", true), text("slug", "Slug"), text("latin", "Latin name"),
          text("family", "Plant family"), text("emoji", "Emoji"), text("variety", "Default variety"),
          number("sow_start_month", "Sow start month", false, "1"), number("sow_end_month", "Sow end month", false, "1"),
          number("harvest_start_month", "Harvest start month", false, "1"), number("harvest_end_month", "Harvest end month", false, "1"),
          number("spacing_in", "Plant spacing (in)"), number("row_spacing_in", "Row spacing (in)"),
          number("depth_in", "Planting depth (in)"), select("sun", "Sun", ["full", "partial", "shade"]),
          select("water", "Water", ["low", "medium", "high"]),
          number("days_to_maturity", "Days to maturity", false, "1"), number("days_to_germinate", "Days to germinate", false, "1"),
          number("indoor_start_weeks_before_frost", "Indoor start weeks before frost", false, "1"),
          number("transplant_weeks_after_frost", "Transplant weeks after frost", false, "1"),
          select("frost_tolerance", "Frost tolerance", ["tender", "half-hardy", "hardy"]),
          checkbox("is_custom", "Custom crop"), checkbox("is_favorite", "Favorite crop"),
          json("companions_json", "Companions JSON"), json("antagonists_json", "Antagonists JSON"),
          area("notes", "Growing notes")
        ],
        columns: [column("name", "Crop"), column("family", "Family"), column("days_to_maturity", "Maturity"), column("frost_tolerance", "Frost")]
      },
      {
        slug: "harvests", label: "Harvests", singular: "harvest", endpoint: "/api/garden/harvests",
        fields: [
          relation("planting_id", "Planting", "/api/garden/plantings", "id", true),
          date("harvested_on", "Harvested", true), number("quantity", "Quantity", true), text("unit", "Unit", true),
          number("weight_oz", "Weight (oz)"), number("qty_count", "Item count", false, "1"),
          select("quality", "Quality", ["excellent", "good", "fair", "poor"]), area("notes", "Notes")
        ],
        columns: [column("harvested_on", "Date", "date"), column("weight_oz", "Weight oz"), column("qty_count", "Count"), column("quality", "Quality")]
      },
      {
        slug: "settings", label: "Settings", singular: "garden setting", endpoint: "/api/garden/settings",
        fields: [
          text("setting_key", "Setting key", true), number("season_year", "Season year", false, "1"),
          relation("active_field_id", "Active field", "/api/garden/fields"),
          select("units", "Units", ["imperial", "metric"]),
          { key: "value_json", label: "Setting value JSON", type: "json", required: true }
        ],
        columns: [column("setting_key", "Setting"), column("season_year", "Season"), column("units", "Units"), column("active_field_id", "Active field")]
      }
    ]
  },
  {
    slug: "pool",
    label: "Pool maintenance",
    coordinate: "P–03",
    description: "Water observations, measured ranges, actions, and chemical stock.",
    heroTitle: "Crystal-clear water, on record",
    icon: Waves,
    resources: [
      {
        slug: "reports", label: "Reports", singular: "pool report", endpoint: "/api/pool/reports",
        fields: [
          { key: "observed_at", label: "Observed at", type: "datetime-local", required: true },
          text("test_date_text", "Printed test date"), select("report_format", "Report format", ["pool360", "clearcare", "manual", "unknown"]),
          text("store_name", "Store"), text("analyst_name", "Analyst"), text("test_id", "Test ID"),
          number("pool_volume_gal", "Pool volume (gal)", false, "1"), text("pool_type", "Pool type"),
          number("water_temperature_f", "Printed water temperature (°F)"),
          number("water_temperature", "Recorded water temperature"), text("filter_type", "Filter type"),
          text("test_kind", "Test type"), checkbox("custom_ideals", "Custom ideals"),
          select("status", "Record status", ["draft", "complete", "reviewed"]),
          select("parse_status", "Parse status", ["manual", "parsed", "failed"]),
          text("parse_model", "Parse model"), area("parse_error", "Parse error"),
          { key: "verified_at", label: "Verified at", type: "datetime-local" },
          blob("blob_id", "Source report PDF", false, "application/pdf"),
          text("file_hash", "File hash"), area("summary", "Water summary"),
          area("handwritten_notes", "Handwritten notes"), area("notes", "Observation notes"),
          json("raw_parse_json", "Raw parse JSON")
        ],
        columns: [column("observed_at", "Observed", "date"), column("report_format", "Format"), column("store_name", "Store"), column("parse_status", "Parse", "status")]
      },
      {
        slug: "readings", label: "Readings", singular: "pool reading", endpoint: "/api/pool/readings",
        fields: [
          relation("report_id", "Report", "/api/pool/reports", "observed_at", true),
          text("metric", "Canonical parameter", true), text("parameter_label", "Printed label"),
          number("value", "Numeric reading", false, "any"), text("value_text", "Printed reading"),
          text("unit", "Unit"), text("ideal_text", "Printed ideal range"),
          number("min_target", "Minimum target", false, "any"), number("max_target", "Maximum target", false, "any"),
          select("status", "Status", ["ok", "low", "high", "unbalanced"]),
          number("position", "Order", false, "1")
        ],
        columns: [
          { key: "parameter_label", label: "Measure", fallbackKey: "metric" },
          { key: "value_text", label: "Reading", fallbackKey: "value" },
          { key: "ideal_text", label: "Ideal" },
          column("status", "State", "status")
        ]
      },
      {
        slug: "recommendations", label: "Actions", singular: "pool action", endpoint: "/api/pool/recommendations",
        fields: [
          relation("report_id", "Report", "/api/pool/reports", "observed_at", true),
          select("source", "Source", ["computer", "handwritten", "manual"]),
          text("title", "Action title", true), text("product", "Product"),
          text("quantity_text", "Quantity"), text("target", "Target"), text("timing", "Timing"),
          select("priority", "Priority", priorities), select("status", "Status", ["open", "completed", "dismissed"]),
          { key: "completed_at", label: "Completed at", type: "datetime-local" },
          number("position", "Order", false, "1"), area("instruction", "Instruction"),
          area("warnings", "Warnings"), area("detail", "Combined details")
        ],
        columns: [
          { key: "product", label: "Product", fallbackKey: "title" },
          column("quantity_text", "Quantity"), column("source", "Source"), column("status", "State", "status")
        ]
      },
      {
        slug: "chemicals", label: "Chemicals", singular: "chemical", endpoint: "/api/pool/chemicals",
        fields: [
          select("category", "Category", ["chlorine_granular", "chlorine_tablet", "ph_increaser", "ph_decreaser", "alkalinity_increaser", "calcium_increaser", "stabilizer", "other"]),
          text("name", "Chemical", true), text("product_name", "Product name"), text("brand", "Brand"),
          text("active_ingredient", "Active ingredient"), number("active_percent", "Active ingredient %"),
          number("available_chlorine_percent", "Available chlorine %"), number("net_weight_lbs", "Net weight (lb)"),
          number("quantity", "On hand"), text("unit", "Unit", true),
          number("low_quantity", "Low at"), date("expires_on", "Expires"), area("notes", "Notes")
        ],
        columns: [
          { key: "product_name", label: "Product", fallbackKey: "name" },
          column("category", "Category"), column("active_ingredient", "Active ingredient"), column("net_weight_lbs", "Net lb")
        ]
      },
      {
        slug: "insights", label: "Insights", singular: "pool insight", endpoint: "/api/pool/insights",
        fields: [
          relation("report_id", "Report", "/api/pool/reports", "observed_at"),
          text("provider", "Provider", true), text("model", "Model"), text("water_health", "Water health"),
          number("report_count", "Reports analyzed", false, "1"),
          select("status", "Status", ["active", "dismissed"]),
          { key: "generated_at", label: "Generated at", type: "datetime-local" },
          area("content", "Insight", true), json("payload_json", "Structured insight JSON")
        ],
        columns: [column("water_health", "Water health", "status"), column("report_count", "Reports"), column("model", "Model"), column("generated_at", "Generated", "date")]
      }
    ]
  },
  {
    slug: "recipes",
    label: "Recipe manager",
    coordinate: "L–01",
    description: "A practical kitchen ledger for recipes, ingredients, and repeatable preparation.",
    heroTitle: "What you cook",
    heroAccent: "cook",
    icon: BookOpen,
    resources: [
      {
        slug: "recipes", label: "Recipes", singular: "recipe", endpoint: "/api/recipes/recipes",
        fields: [
          text("name", "Recipe name", true), area("description", "Description"), number("servings", "Servings", false, "1"),
          number("prep_minutes", "Prep minutes", false, "1"), number("cook_minutes", "Cook minutes", false, "1"),
          area("instructions", "Instructions"), area("tags_json", "Tags JSON")
        ],
        columns: [column("name", "Recipe"), column("servings", "Serves"), column("prep_minutes", "Prep min"), column("cook_minutes", "Cook min")]
      },
      {
        slug: "ingredients", label: "Ingredients", singular: "ingredient", endpoint: "/api/recipes/ingredients",
        fields: [
          relation("recipe_id", "Recipe", "/api/recipes/recipes", "name", true), text("name", "Ingredient", true),
          number("quantity", "Quantity"), text("unit", "Unit"), number("position", "Order", false, "1")
        ],
        columns: [column("name", "Ingredient"), column("quantity", "Quantity", "quantity"), column("unit", "Unit"), column("position", "Order")]
      }
    ]
  }
];

export function getDomain(slug: string | undefined): DomainConfig | undefined {
  return domains.find((domain) => domain.slug === slug);
}
