// Move host data into the Docker volumes (import), or back the volumes up to an archive (export).
// Import copies data/private (CV, preferences, optional imap-password) and, if there is one, the host database and
// applications folder. Usage: pnpm docker:import [--force] | pnpm docker:export
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const HOST_OUTPUT = process.env.JOB_SCOUT_HOST_OUTPUT_DIR ?? join(homedir(), "Documents/Job Scout");
const STAGE = join(REPO, "out/docker-import");

/** A throwaway container with the service's volumes plus extra mounts; never the long-running dashboard container. */
function inContainer(script: string, mounts: string[] = [], env: Record<string, string> = {}) {
  const args = ["compose", "run", "--rm", "--no-deps", "-T", ...mounts.flatMap((m) => ["-v", m]), ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), "job-scout", "sh", "-c", script];
  const r = spawnSync("docker", args, { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`container step failed:\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function importData(force: boolean) {
  const running = spawnSync("docker", ["compose", "ps", "-q", "job-scout"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  if (running) throw new Error("the job-scout container is running; stop it first with `docker compose down`");
  if (!existsSync(join(REPO, "data/private"))) throw new Error("nothing to import: data/private doesn't exist (see Setup in the README)");
  // A fresh setup has private inputs but no database yet; then only data/private is copied.
  const hasDb = existsSync(join(REPO, "data/job-scout.db"));
  if (hasDb && !force && inContainer("test -f /app/data/job-scout.db && echo present || echo empty") === "present") {
    throw new Error("the data volume already has a database; re-run with --force to overwrite it with the host copy");
  }
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  // A consistent copy even if the host dashboard has the database open.
  if (hasDb) execFileSync("sqlite3", [join(REPO, "data/job-scout.db"), `.backup ${join(STAGE, "job-scout.db")}`]);
  // Stored CV paths are absolute host paths from before relative storage; make them relative to the output root.
  writeFileSync(
    join(STAGE, "migrate.cjs"),
    `const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/app/data/job-scout.db");
const root = process.env.OLD_ROOT.replace(/\\/$/, "") + "/";
let n = 0;
for (const r of db.prepare("SELECT id, tailor FROM jobs WHERE tailor IS NOT NULL").all()) {
  const t = JSON.parse(r.tailor);
  let changed = false;
  for (const k of ["dir", "cvFile"]) if (typeof t[k] === "string" && t[k].startsWith(root)) (t[k] = t[k].slice(root.length)), (changed = true);
  if (changed) db.prepare("UPDATE jobs SET tailor = ? WHERE id = ?").run(JSON.stringify(t), r.id), n++;
}
const jobs = db.prepare("SELECT count(*) AS n FROM jobs").get().n;
console.log(JSON.stringify({ jobs, pathsRewritten: n }));
`,
  );
  const mounts = [`${STAGE}:/seed/db:ro`, `${join(REPO, "data/private")}:/seed/private:ro`];
  const hasOutput = hasDb && existsSync(HOST_OUTPUT);
  if (hasOutput) mounts.push(`${HOST_OUTPUT}:/seed/applications:ro`);
  const out = inContainer(
    [
      "set -e",
      "mkdir -p /app/data/private && cp -R /seed/private/. /app/data/private/",
      ...(hasDb
        ? [
            "rm -f /app/data/job-scout.db /app/data/job-scout.db-wal /app/data/job-scout.db-shm",
            "cp /seed/db/job-scout.db /app/data/job-scout.db",
            hasOutput ? "cp -R /seed/applications/. /app/applications/" : "true",
            "node --disable-warning=ExperimentalWarning /seed/db/migrate.cjs",
          ]
        : ["ls /app/data/private | tr '\\n' ' '"]),
    ].join(" && "),
    mounts,
    { OLD_ROOT: HOST_OUTPUT },
  );
  rmSync(STAGE, { recursive: true, force: true });
  if (!hasDb) console.log(`copied data/private into the job-scout-data volume: ${out}`);
  else console.log(`imported into the job-scout volumes: ${out}${hasOutput ? "" : " (no host applications folder found)"}`);
}

function exportData() {
  const dir = join(REPO, "backups");
  mkdirSync(dir, { recursive: true });
  const name = `job-scout-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.tar.gz`;
  // VACUUM INTO takes a consistent snapshot while the dashboard keeps running. The live database files are excluded by
  // name, so the snapshot gets a different one.
  inContainer(
    [
      "set -e",
      "rm -rf /tmp/snap && mkdir -p /tmp/snap",
      // The target path is a bound parameter: SQLite treats a double-quoted name as a column, not a string.
      `node --disable-warning=ExperimentalWarning -e 'new (require("node:sqlite").DatabaseSync)("/app/data/job-scout.db").prepare("VACUUM INTO ?").run("/tmp/snap/job-scout.snapshot.db")'`,
      `tar czf /backup/${name} --exclude=job-scout.db --exclude=job-scout.db-wal --exclude=job-scout.db-shm -C /app data applications -C /tmp snap`,
    ].join(" && "),
    [`${dir}:/backup`],
  );
  console.log(`backup written: backups/${name} (database snapshot: snap/job-scout.snapshot.db)`);
}

const cmd = process.argv[2];
try {
  if (cmd === "import") importData(process.argv.includes("--force"));
  else if (cmd === "export") exportData();
  else {
    console.error("usage: pnpm docker:import [--force] | pnpm docker:export");
    process.exit(2);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
