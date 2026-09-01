import { Archive, BookOpen, Sprout, Trees, Waves, Wrench, type LucideIcon } from "lucide-react";

export interface FieldConfig {
  key: string;
  label: string;
  type?: "text" | "textarea" | "date" | "datetime-local" | "number" | "select";
  required?: boolean;
  step?: string;
  options?: string[];
  relation?: { path: string; labelKey: string };
  help?: string;
}

export interface ResourceConfig {
  slug: string;
  label: string;
  singular: string;
  endpoint: string;
  fields: FieldConfig[];
  columns: { key: string; label: string; format?: "date" | "money" | "status" | "quantity" }[];
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
const area = (key: string, label: string): FieldConfig => ({ key, label, type: "textarea" });
const date = (key: string, label: string, required = false): FieldConfig => ({ key, label, type: "date", required });
const number = (key: string, label: string, required = false, step = "0.01"): FieldConfig =>
  ({ key, label, type: "number", required, step });
const select = (key: string, label: string, options: string[]): FieldConfig =>
  ({ key, label, type: "select", options });
const relation = (
  key: string,
  label: string,
  path: string,
  labelKey = "name",
  required = false
): FieldConfig => ({ key, label, required, type: "select", relation: { path, labelKey } });
const column = (key: string, label: string, format?: "date" | "money" | "status" | "quantity") =>
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
          text("name", "Item name", true), text("location", "Location"), text("manufacturer", "Manufacturer"),
          text("model", "Model"), text("serial_number", "Serial number"), date("purchased_on", "Purchased"),
          date("installed_on", "Installed"), text("qr_identifier", "HEARTH QR identifier", false, "Preserve the exact printed identifier."),
          area("description", "Notes")
        ],
        columns: [column("name", "Item"), column("location", "Place"), column("manufacturer", "Maker"), column("qr_identifier", "QR")]
      },
      {
        slug: "tasks", label: "Service ledger", singular: "maintenance task", endpoint: "/api/maintenance/tasks",
        fields: [
          text("title", "Work to do", true), relation("home_item_id", "Home item", "/api/maintenance/items"),
          date("due_on", "Due"), select("priority", "Priority", priorities), select("status", "Status", states),
          number("recurrence_days", "Repeat every (days)", false, "1"), area("description", "Work notes")
        ],
        columns: [column("title", "Obligation"), column("due_on", "Due", "date"), column("priority", "Priority", "status"), column("status", "State", "status")]
      },
      {
        slug: "warranties", label: "Warranties", singular: "warranty", endpoint: "/api/maintenance/warranties",
        fields: [
          relation("home_item_id", "Home item", "/api/maintenance/items", "name", true),
          text("provider", "Provider"), text("policy_number", "Policy number"), date("starts_on", "Starts"),
          date("expires_on", "Expires"), area("notes", "Coverage notes")
        ],
        columns: [column("provider", "Provider"), column("policy_number", "Policy"), column("expires_on", "Expires", "date")]
      },
      {
        slug: "costs", label: "Costs", singular: "maintenance cost", endpoint: "/api/maintenance/costs",
        fields: [
          relation("home_item_id", "Home item", "/api/maintenance/items"),
          relation("task_id", "Service task", "/api/maintenance/tasks", "title"),
          number("amount_cents", "Amount in cents", true, "1"), text("currency", "Currency", false, "Three-letter code, for example USD."),
          date("incurred_on", "Date", true), text("vendor", "Vendor"), area("notes", "Notes")
        ],
        columns: [column("incurred_on", "Date", "date"), column("vendor", "Vendor"), column("amount_cents", "Amount", "money")]
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
          number("quantity", "Quantity"), number("low_quantity", "Low at"), text("unit", "Unit"),
          date("expires_on", "Expires"), date("purchased_on", "Purchased"), number("value_cents", "Value in cents", false, "1"),
          text("qr_identifier", "HEARTH QR identifier"), area("description", "Notes")
        ],
        columns: [column("name", "Item"), column("quantity", "On hand", "quantity"), column("low_quantity", "Low at", "quantity"), column("expires_on", "Expires", "date")]
      },
      {
        slug: "categories", label: "Categories", singular: "category", endpoint: "/api/inventory/categories",
        fields: [text("name", "Category name", true), area("description", "Description")],
        columns: [column("name", "Category"), column("description", "Use")]
      },
      {
        slug: "locations", label: "Locations", singular: "location", endpoint: "/api/inventory/locations",
        fields: [text("name", "Location name", true), text("qr_identifier", "HEARTH QR identifier"), area("description", "Description")],
        columns: [column("name", "Location"), column("qr_identifier", "QR"), column("description", "Description")]
      },
      {
        slug: "sub-locations", label: "Sub-locations", singular: "sub-location", endpoint: "/api/inventory/sub-locations",
        fields: [relation("location_id", "Parent location", "/api/inventory/locations", "name", true), text("name", "Sub-location name", true), area("description", "Description")],
        columns: [column("name", "Sub-location"), column("location_id", "Parent ID"), column("description", "Description")]
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
          text("qr_identifier", "HEARTH QR identifier"), area("description", "Field notes")
        ],
        columns: [column("name", "Area"), column("area_sq_ft", "Sq ft", "quantity"), column("qr_identifier", "QR")]
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
          text("conditions", "Conditions"), text("provider", "Source", true)
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
          number("area_sq_ft", "Area (sq ft)"), text("qr_identifier", "HEARTH QR identifier"), area("description", "Bed notes")
        ],
        columns: [column("name", "Bed"), column("area_sq_ft", "Sq ft"), column("qr_identifier", "QR")]
      },
      {
        slug: "plantings", label: "Plantings", singular: "planting", endpoint: "/api/garden/plantings",
        fields: [
          relation("bed_id", "Bed", "/api/garden/beds", "name", true),
          relation("vegetable_id", "Crop", "/api/garden/vegetables"),
          date("planted_on", "Planted"), date("expected_harvest_on", "Expected harvest"),
          number("quantity", "Count", false, "1"),
          select("status", "Status", ["planned", "planted", "harvesting", "finished", "failed"]), area("notes", "Notes")
        ],
        columns: [column("planted_on", "Planted", "date"), column("expected_harvest_on", "Harvest", "date"), column("status", "State", "status"), column("quantity", "Count")]
      },
      {
        slug: "tasks", label: "Garden work", singular: "garden task", endpoint: "/api/garden/tasks",
        fields: [
          text("title", "Work to do", true), relation("bed_id", "Bed", "/api/garden/beds"),
          relation("planting_id", "Planting", "/api/garden/plantings", "id"), date("due_on", "Due"),
          select("priority", "Priority", priorities), select("status", "Status", states), area("notes", "Notes")
        ],
        columns: [column("title", "Work"), column("due_on", "Due", "date"), column("priority", "Priority", "status"), column("status", "State", "status")]
      },
      {
        slug: "shopping", label: "Shopping", singular: "shopping item", endpoint: "/api/garden/shopping",
        fields: [
          text("name", "Need", true), relation("planting_id", "Planting", "/api/garden/plantings", "id"),
          number("quantity", "Quantity"), text("unit", "Unit"),
          select("status", "Status", ["needed", "purchased", "cancelled"]), area("notes", "Notes")
        ],
        columns: [column("name", "Need"), column("quantity", "Quantity", "quantity"), column("status", "State", "status")]
      },
      {
        slug: "fields", label: "Fields", singular: "garden field", endpoint: "/api/garden/fields",
        fields: [relation("yard_location_id", "Yard area", "/api/yard/locations"), text("name", "Field name", true), area("description", "Description")],
        columns: [column("name", "Field"), column("description", "Description")]
      },
      {
        slug: "vegetables", label: "Crop catalog", singular: "crop", endpoint: "/api/garden/vegetables",
        fields: [text("name", "Crop", true), text("variety", "Variety"), number("days_to_maturity", "Days to maturity", false, "1"), area("notes", "Notes")],
        columns: [column("name", "Crop"), column("variety", "Variety"), column("days_to_maturity", "Days")]
      },
      {
        slug: "harvests", label: "Harvests", singular: "harvest", endpoint: "/api/garden/harvests",
        fields: [
          relation("planting_id", "Planting", "/api/garden/plantings", "id", true),
          date("harvested_on", "Harvested", true), number("quantity", "Quantity", true), text("unit", "Unit", true), area("notes", "Notes")
        ],
        columns: [column("harvested_on", "Date", "date"), column("quantity", "Yield", "quantity"), column("unit", "Unit")]
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
          select("status", "Status", ["draft", "complete", "reviewed"]),
          number("water_temperature", "Water temperature"), area("notes", "Observation notes")
        ],
        columns: [column("observed_at", "Observed", "date"), column("water_temperature", "Water temp"), column("status", "State", "status")]
      },
      {
        slug: "readings", label: "Readings", singular: "pool reading", endpoint: "/api/pool/readings",
        fields: [
          relation("report_id", "Report", "/api/pool/reports", "observed_at", true),
          text("metric", "Metric", true), number("value", "Reading", true, "any"), text("unit", "Unit", true),
          number("min_target", "Minimum target", false, "any"), number("max_target", "Maximum target", false, "any")
        ],
        columns: [column("metric", "Measure"), column("value", "Reading"), column("unit", "Unit"), column("min_target", "Min"), column("max_target", "Max")]
      },
      {
        slug: "recommendations", label: "Actions", singular: "pool action", endpoint: "/api/pool/recommendations",
        fields: [
          relation("report_id", "Report", "/api/pool/reports", "observed_at", true), text("title", "Action", true),
          select("priority", "Priority", priorities), select("status", "Status", ["open", "completed", "dismissed"]), area("detail", "Details")
        ],
        columns: [column("title", "Action"), column("priority", "Priority", "status"), column("status", "State", "status")]
      },
      {
        slug: "chemicals", label: "Chemicals", singular: "chemical", endpoint: "/api/pool/chemicals",
        fields: [
          text("name", "Chemical", true), number("quantity", "On hand"), text("unit", "Unit", true),
          number("low_quantity", "Low at"), date("expires_on", "Expires"), area("notes", "Notes")
        ],
        columns: [column("name", "Chemical"), column("quantity", "On hand", "quantity"), column("low_quantity", "Low at"), column("expires_on", "Expires", "date")]
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
