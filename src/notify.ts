// macOS notification when a run finishes or needs an AWS login. No-op elsewhere, and only when JOB_SCOUT_NOTIFY=1, which
// the dashboard sets for runs it starts; terminal runs print to the console instead.
import { execFile } from "node:child_process";

export function notify(message: string, title = "job-scout"): void {
  if (process.platform !== "darwin" || process.env.JOB_SCOUT_NOTIFY !== "1") return;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execFile("osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}"`], () => {});
}
