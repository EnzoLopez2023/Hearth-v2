import fs from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
if (fs.existsSync(new URL(".git", root))) {
  const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: root,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
