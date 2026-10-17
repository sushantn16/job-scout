// Install, remove or inspect the launchd job that keeps the dashboard running (http://127.0.0.1:8765).
// Pipeline runs are started by hand, from the dashboard or with `pnpm scan`. Usage: pnpm service:install|uninstall|status
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const AGENTS = join(homedir(), "Library/LaunchAgents");
const LOGS = join(REPO, "data/private/logs");
const DOMAIN = `gui/${userInfo().uid}`;
const DASHBOARD = "local.job-scout.dashboard";
// launchd starts jobs with a bare PATH, and nvm's node is only on PATH in interactive shells. Record where node and pnpm
// are right now; after switching Node versions, run service:install again.
const NODE_DIR = dirname(process.execPath);
const PNPM = execFileSync("/bin/zsh", ["-lc", "command -v pnpm"], { encoding: "utf8" }).trim();
const PATH = [...new Set([NODE_DIR, dirname(PNPM), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(":");

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const strings = (xs: string[]) => xs.map((x) => `<string>${xml(x)}</string>`).join("");
const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>
`;
const env = (extra: Record<string, string> = {}) =>
  `<key>EnvironmentVariables</key><dict>${Object.entries({ PATH, HOME: homedir(), ...extra }).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join("")}</dict>`;

const JOBS: Record<string, string> = {
  [DASHBOARD]: plist(
    `<key>Label</key><string>${DASHBOARD}</string>
<key>ProgramArguments</key><array>${strings([PNPM, "-s", "dashboard"])}</array>
<key>WorkingDirectory</key><string>${xml(REPO)}</string>
${env()}
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(join(LOGS, "dashboard.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(LOGS, "dashboard.log"))}</string>`,
  ),
};

const launchctl = (...args: string[]) => spawnSync("launchctl", args, { encoding: "utf8" });

/** bootout returns before launchd has torn the job down; bootstrapping too early fails with "5: Input/output error". */
function bootoutAndWait(label: string) {
  launchctl("bootout", `${DOMAIN}/${label}`);
  for (let i = 0; i < 50 && launchctl("print", `${DOMAIN}/${label}`).status === 0; i++) spawnSync("sleep", ["0.2"]);
}

function status() {
  for (const label of Object.keys(JOBS)) {
    const r = launchctl("print", `${DOMAIN}/${label}`);
    if (r.status !== 0) {
      console.log(`${label}: not installed`);
      continue;
    }
    const field = (name: string) => r.stdout.match(new RegExp(`^\\s*${name} = (.*)$`, "m"))?.[1] ?? "?";
    console.log(`${label}: state ${field("state")}, last exit code ${field("last exit code")}, runs ${field("runs")}`);
  }
}

const cmd = process.argv[2];
if (cmd === "install") {
  console.log("Building the dashboard…");
  execFileSync(PNPM, ["-s", "dashboard:build"], { cwd: REPO, stdio: "inherit" });
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(AGENTS, { recursive: true });
  for (const [label, body] of Object.entries(JOBS)) {
    const file = join(AGENTS, `${label}.plist`);
    bootoutAndWait(label);
    writeFileSync(file, body);
    const r = launchctl("bootstrap", DOMAIN, file);
    console.log(r.status === 0 ? `installed ${label}` : `FAILED ${label}: ${r.stderr.trim()}`);
  }
  console.log(`node: ${NODE_DIR}\npnpm: ${PNPM}`);
  status();
} else if (cmd === "uninstall") {
  for (const label of Object.keys(JOBS)) {
    launchctl("bootout", `${DOMAIN}/${label}`);
    rmSync(join(AGENTS, `${label}.plist`), { force: true });
    console.log(`removed ${label}`);
  }
} else if (cmd === "status") {
  status();
} else {
  console.error("usage: pnpm service:install | service:uninstall | service:status");
  process.exit(2);
}
