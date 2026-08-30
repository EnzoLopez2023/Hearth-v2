import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/database.js";
import { createProviders } from "../providers/index.js";
import { importLegacyDatabase } from "./importer.js";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    household: { type: "string" },
    namespace: { type: "string" }
  },
  strict: true
});
if (!values.source || !values.household) {
  console.error("Usage: npm run legacy:import -- --source <legacy.db> --household <household-id> [--namespace <stable-name>]");
  process.exitCode = 2;
} else {
  const config = loadConfig();
  const db = openDatabase(config);
  try {
    const providers = createProviders(config);
    const result = await importLegacyDatabase({
      target: db,
      sourcePath: values.source,
      householdId: values.household,
      blobProvider: providers.blob,
      ...(values.namespace ? { sourceNamespace: values.namespace } : {})
    });
    console.log(JSON.stringify(result));
  } finally {
    db.close();
  }
}
