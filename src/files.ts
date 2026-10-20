import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write a JSON file you edit from the dashboard, keeping the version it replaces as `<name>.prev.json`: the data
 * volume is the only copy of these files, and one bad save shouldn't lose what you had written.
 */
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, path.replace(/\.json$/, ".prev.json"));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
