// Make sure the AWS profile has a live session before any LLM stage runs. The check uses the AWS SDK, so it works
// anywhere; renewing an expired SSO session needs `aws sso login` (a browser approval), which only runs where the AWS CLI
// is installed. In the Docker image there is no CLI: the run stops with the command to run on the host instead, and the
// mounted ~/.aws shares the refreshed token with the container.
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fromIni } from "@aws-sdk/credential-providers";
import { provider } from "../llm/client.ts";

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface SessionResult {
  ok: boolean;
  /** What happened, for the event log: "valid", "renewed via SSO login", or why it failed. */
  detail: string;
}

/**
 * Resolve the profile's credentials. For an SSO profile this exchanges the cached token for role credentials, so it fails
 * once the session has expired; that is the check. (Static keys resolve without a network call and aren't verified.)
 * A fresh provider each time: providers cache, and a check after login must not reuse the old result.
 */
async function check(profile: string): Promise<{ ok: boolean; error: string }> {
  try {
    await fromIni({ profile })();
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Whether ~/.aws/config (or AWS_CONFIG_FILE) gives the profile an SSO login: sso_start_url or sso_session. */
async function isSsoProfile(profile: string): Promise<boolean> {
  const file = process.env.AWS_CONFIG_FILE ?? join(homedir(), ".aws", "config");
  const text = await readFile(file, "utf8").catch(() => "");
  const header = profile === "default" ? /^\[\s*(?:profile\s+)?default\s*\]$/ : new RegExp(`^\\[\\s*profile\\s+${profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]$`);
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) inside = header.test(line);
    else if (inside && /^(sso_start_url|sso_session)\s*=\s*\S/.test(line)) return true;
  }
  return false;
}

const hasCli = () => new Promise<boolean>((resolve) => execFile("aws", ["--version"], (err) => resolve(!err)));

/**
 * `log` receives progress lines, including the login URL and code that `aws sso login` prints in case the browser
 * doesn't open by itself. Without AWS_PROFILE (credentials from the environment) there is nothing to manage.
 */
export async function ensureAwsSession(log: (line: string) => void): Promise<SessionResult> {
  if (provider() !== "bedrock") return { ok: true, detail: "not needed: the models are reached through an OpenAI-compatible API" };
  const profile = process.env.AWS_PROFILE;
  if (!profile) return { ok: true, detail: "no AWS_PROFILE; using credentials from the environment" };

  const first = await check(profile);
  if (first.ok) return { ok: true, detail: "valid" };
  if (!(await isSsoProfile(profile))) return { ok: false, detail: `AWS profile ${profile} has no valid credentials and isn't an SSO profile: ${first.error.slice(0, 200)}` };
  if (!(await hasCli())) {
    return { ok: false, detail: `the AWS SSO session for ${profile} has expired. Run \`aws sso login --profile ${profile}\` on your Mac, then start the run again` };
  }

  log(`AWS SSO session for ${profile} has expired: approve the login in your browser`);
  const login = await new Promise<{ ok: boolean; timedOut: boolean; out: string }>((resolve) => {
    // Where no browser can be opened, the device-code flow prints a URL and code to approve elsewhere.
    const args = ["sso", "login", "--profile", profile, ...(process.env.JOB_SCOUT_SSO_DEVICE_CODE === "1" ? ["--use-device-code"] : [])];
    const child = spawn("aws", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const onData = (b: Buffer) => {
      out += b;
      // Pass on the lines that matter if the browser doesn't open: the URL and the one-time code.
      for (const line of b.toString().split("\n").map((l) => l.trim())) if (/https:\/\/|code|browser/i.test(line)) log(line);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    let timedOut = false;
    const timer = setTimeout(() => ((timedOut = true), child.kill()), LOGIN_TIMEOUT_MS);
    child.on("exit", (code) => (clearTimeout(timer), resolve({ ok: code === 0, timedOut, out })));
  });
  if (!login.ok) {
    const why = login.timedOut ? `wasn't approved within ${LOGIN_TIMEOUT_MS / 60_000} minutes` : `failed: ${login.out.trim().split("\n").pop()?.slice(0, 200)}`;
    return { ok: false, detail: `SSO login for ${profile} ${why}` };
  }
  const second = await check(profile);
  return second.ok ? { ok: true, detail: "renewed via SSO login" } : { ok: false, detail: `still no valid session after login: ${second.error.slice(0, 200)}` };
}
