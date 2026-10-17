// Read recent application emails from Gmail over IMAP. Read-only: the mailbox is opened with EXAMINE, so nothing is
// marked as read. The app password lives in the macOS Keychain, never in .env.
import { execFile } from "node:child_process";
import { ImapFlow } from "imapflow";
import { htmlToText } from "../text.ts";

export const KEYCHAIN_SERVICE = "job-scout-imap";

/** A node of an IMAP BODYSTRUCTURE as imapflow returns it. */
export interface StructurePart {
  part?: string;
  type: string;
  disposition?: string;
  childNodes?: StructurePart[];
}

/**
 * The part to read as the email's text: the first text/plain body, else the first text/html, skipping attachments.
 * A single-part message has no part number; IMAP calls its body part "1".
 */
export function textPart(root: StructurePart): { part: string; html: boolean } | null {
  const walk = (node: StructurePart, want: string): StructurePart | null => {
    if (node.childNodes?.length) {
      for (const c of node.childNodes) {
        const hit = walk(c, want);
        if (hit) return hit;
      }
      return null;
    }
    return node.type.toLowerCase() === want && node.disposition?.toLowerCase() !== "attachment" ? node : null;
  };
  const plain = walk(root, "text/plain");
  const html = plain ? null : walk(root, "text/html");
  const hit = plain ?? html;
  return hit ? { part: hit.part ?? "1", html: !plain } : null;
}

export interface Email {
  messageId: string;
  date: string;
  from: string;
  subject: string;
  text: string;
}

/**
 * The app password: from JOB_SCOUT_IMAP_PASSWORD_FILE when set (Docker, where there is no Keychain), else the macOS
 * Keychain.
 */
async function appPassword(account: string): Promise<string> {
  const file = process.env.JOB_SCOUT_IMAP_PASSWORD_FILE;
  if (file) {
    const { readFile } = await import("node:fs/promises");
    return (await readFile(file, "utf8").catch(() => { throw new Error(`can't read the app password from ${file}`); })).trim();
  }
  return keychainPassword(account);
}

const keychainPassword = (account: string) =>
  new Promise<string>((resolve, reject) =>
    execFile("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"], { encoding: "utf8" }, (err, out) =>
      err ? reject(new Error(`no app password in the Keychain for ${account} (service ${KEYCHAIN_SERVICE})`)) : resolve(out.trim()),
    ),
  );

const ATS_DOMAINS = ["ashbyhq.com", "greenhouse.io", "lever.co", "personio.de", "personio.com", "workablemail.com", "smartrecruiters.com", "recruitee.com", "join.com", "teamtailor.com", "myworkday.com", "bamboohr.com", "linkedin.com"];

/**
 * Emails from the last `days` days that come from an applicant-tracking sender or name one of `companies` in the
 * subject. Uses Gmail's own search syntax (X-GM-RAW), so the filtering happens server-side.
 */
export async function fetchApplicationEmails(user: string, companies: string[], days = 30): Promise<Email[]> {
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass: await appPassword(user) }, logger: false });
  await client.connect();
  try {
    // Find All Mail by its special-use flag: its name is localized ("[Gmail]/Alle Nachrichten" in German).
    const boxes = await client.list();
    const all = boxes.find((b) => b.specialUse === "\\All")?.path ?? "INBOX";
    const lock = await client.getMailboxLock(all, { readOnly: true });
    try {
      const names = companies.filter((c) => c.length >= 3).slice(0, 40).map((c) => `"${c.replace(/"/g, "")}"`);
      const query = `newer_than:${days}d (${[...ATS_DOMAINS.map((d) => `from:${d}`), ...(names.length ? [`subject:(${names.join(" OR ")})`] : [])].join(" OR ")})`;
      const uids = (await client.search({ gmraw: query }, { uid: true })) || [];
      const emails: Email[] = [];
      for (const uid of uids.slice(-300)) {
        // Envelope fields arrive decoded; only the text part is downloaded (imapflow decodes it to UTF-8).
        const msg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, internalDate: true }, { uid: true });
        if (!msg) continue;
        const env = msg.envelope;
        const sender = env?.from?.[0];
        let text = "";
        const tp = msg.bodyStructure ? textPart(msg.bodyStructure as StructurePart) : null;
        if (tp) {
          const { content } = await client.download(String(uid), tp.part, { uid: true, maxBytes: 200_000 });
          let raw = "";
          if (content) for await (const chunk of content) raw += chunk.toString();
          text = (tp.html ? htmlToText(raw) : raw).slice(0, 8000);
        }
        emails.push({
          messageId: env?.messageId ?? `uid:${uid}`,
          date: new Date(env?.date ?? msg.internalDate ?? Date.now()).toISOString(),
          from: sender ? `${sender.name ? `${sender.name} ` : ""}<${sender.address ?? ""}>` : "",
          subject: env?.subject ?? "",
          text,
        });
      }
      return emails;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
