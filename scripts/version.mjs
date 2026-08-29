import fs from "node:fs";

const field = process.argv[2];
if (!["build", "patch", "minor", "major"].includes(field)) {
  throw new Error("Usage: node scripts/version.mjs <build|patch|minor|major>");
}

const file = new URL("../version.json", import.meta.url);
const version = JSON.parse(fs.readFileSync(file, "utf8"));
if (field === "major") {
  version.major += 1;
  version.minor = 0;
  version.patch = 0;
} else if (field === "minor") {
  version.minor += 1;
  version.patch = 0;
} else {
  version[field] += 1;
}
fs.writeFileSync(file, `${JSON.stringify(version, null, 2)}\n`);
