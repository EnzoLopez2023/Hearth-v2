import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { build } from "vite";

try {
  await access(new URL("../src/client/index.html", import.meta.url), constants.R_OK);
  await build({ configFile: new URL("../vite.config.ts", import.meta.url).pathname });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.log("Client source not present; backend build completed.");
}
