import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Cv } from "./schema.ts";

const FONTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
const dataUrl = (path: string, mime: string) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Escape first, then turn **emphasis** into <strong>; the source text never carries raw HTML.
const rich = (s: string) => escape(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

const ICONS = {
  mail: '<path d="M2 4h20v16H2z" fill="none"/><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5Z"/>',
  phone: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z"/>',
  linkedin: '<path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM8.3 18.3H5.7V9.8h2.6Zm-1.3-9.7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm11.3 9.7h-2.6v-4.1c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.2H10V9.8h2.5v1.2a2.7 2.7 0 0 1 2.5-1.4c2.6 0 3.1 1.7 3.1 4Z"/>',
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/>',
  // Globe (Material Icons, Apache 2.0) and the GitHub mark (Octicons, MIT, drawn on 16 px and scaled to 24).
  web: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8 8 0 0 1 18.9 8ZM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96ZM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26Zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 0 1 5.08 16Zm2.95-8H5.08a8 8 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.03 8ZM12 19.96A14.1 14.1 0 0 1 10.09 16h3.82A14.1 14.1 0 0 1 12 19.96ZM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4Zm.25 5.56A15.7 15.7 0 0 0 15.97 16h2.95a8 8 0 0 1-4.33 3.56ZM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4h-3.38Z"/>',
  github: '<path transform="scale(1.5)" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>',
};
const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const withScheme = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);
const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const link = (url: string, name: keyof typeof ICONS) =>
  `<span>${icon(name)}<a href="${escape(withScheme(url))}">${escape(bare(url))}</a></span>`;

/** Two columns as before; with a website or GitHub, three, so the header gets no taller and the CV still fits a page. */
function contactLine(basics: Cv["basics"]): string {
  const email = `<span>${icon("mail")}${escape(basics.email)}</span>`;
  const phone = `<span>${icon("phone")}${escape(basics.phone)}</span>`;
  const place = `<span>${icon("pin")}${escape(basics.location)}</span>`;
  const linkedin = link(basics.linkedin, "linkedin");
  const extra = [basics.website && link(basics.website, "web"), basics.github && link(basics.github, "github")].filter(Boolean);
  const cells = extra.length ? [email, phone, place, linkedin, ...extra] : [email, phone, linkedin, place];
  return `<div class="contact${extra.length ? " three" : ""}">${cells.join("")}</div>`;
}

// Static (non-variable) fonts: Chrome embeds variable fonts as Type 3, which some ATS parsers mishandle.
const font = (file: string) => dataUrl(resolve(FONTS, file), "font/ttf");
const CSS = () => `
@font-face { font-family: "Open Sans"; src: url(${font("OpenSans-Regular.ttf")}); font-weight: 400; font-style: normal; }
@font-face { font-family: "Open Sans"; src: url(${font("OpenSans-Bold.ttf")}); font-weight: 700; font-style: normal; }
@font-face { font-family: "Open Sans"; src: url(${font("OpenSans-Italic.ttf")}); font-weight: 400; font-style: italic; }
/* Open Sans has no arrows ("Full Stack → Senior"). Without this each system substitutes its own font (Lucida Grande on
   macOS, Liberation Sans on Linux); a vendored fallback keeps the glyph identical everywhere. */
@font-face { font-family: "CV Symbols"; src: url(${font("DejaVuSans.ttf")}); font-weight: 400; unicode-range: U+2190-21FF; }
@font-face { font-family: "CV Symbols"; src: url(${font("DejaVuSans-Bold.ttf")}); font-weight: 700; unicode-range: U+2190-21FF; }
@page { size: A4; margin: 10mm 14mm 10mm 14mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Open Sans", "CV Symbols", sans-serif; font-size: 9.8pt; line-height: 1.22; color: #222; }
header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4mm; }
h1 { font-size: 18.5pt; font-weight: 700; color: #111; line-height: 1.2; }
h1 em { font-size: 12.5pt; font-weight: 400; margin-left: 2mm; }
.contact { display: grid; grid-template-columns: auto auto; justify-content: start; column-gap: 7mm; row-gap: 2.4mm; margin-top: 2mm; }
.contact span { display: inline-flex; align-items: center; gap: 1.8mm; }
.contact svg { width: 3.4mm; height: 3.4mm; fill: #222; }
.contact.three { grid-template-columns: auto auto auto; column-gap: 6mm; }
.contact a { color: inherit; text-decoration: none; }
.photo { width: 27mm; height: 27mm; border-radius: 50%; object-fit: cover; }
section { margin-top: 3.2mm; }
h2 { font-size: 12.2pt; font-weight: 700; color: #111; border-bottom: 1.4px solid #111; padding-bottom: 0.3mm; margin-bottom: 1.2mm; }
.profile { text-align: justify; }
/* Custom markers (native ones shrink to faint dots at small indents). No positioning: positioned
   boxes are painted in a later layer, which scrambles the PDF text order that ATS parsers read. */
ul { list-style: none; padding-left: 6mm; }
ul.skills, ul.projects { padding-left: 3.2mm; }
.projects a { color: inherit; text-decoration: none; }
li { margin-bottom: 0.1mm; }
li::before { content: "•"; display: inline-block; width: 2.6mm; margin-left: -2.6mm; color: #111; }
strong { font-weight: 700; color: #111; }
.role { margin-top: 1.6mm; }
.role:first-of-type { margin-top: 0; }
.row { display: flex; justify-content: space-between; font-size: 10.4pt; }
.row b { font-weight: 700; color: #111; }
.edu .row { margin-top: 1.6mm; }
`;

export function renderCvHtml(cv: Cv, photoPath?: string): string {
  const { basics } = cv;
  const photo = photoPath ? `<img class="photo" src="${dataUrl(photoPath, "image/jpeg")}" alt="">` : "";
  const roles = cv.experience
    .map(
      (r) => `<div class="role">
  <div class="row"><span><b>${escape(r.title)},</b> ${escape(r.company)}</span><span>${escape(r.start)} – ${escape(r.end)} &nbsp;|&nbsp; ${escape(r.location)}</span></div>
  <ul>${r.bullets.map((b) => `<li>${rich(b.text)}</li>`).join("")}</ul>
</div>`,
    )
    .join("\n");
  const projects = cv.projects?.length
    ? `<section><h2>Projects</h2><ul class="projects">${cv.projects
        .map((p) => {
          const name = `<strong>${escape(p.name)}</strong>`;
          const stack = p.stack ? ` (${escape(p.stack)})` : "";
          return `<li>${p.url ? `<a href="${escape(withScheme(p.url))}">${name}</a>` : name}${stack}: ${rich(p.text)}</li>`;
        })
        .join("")}</ul></section>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(basics.name)} CV</title>
<style>${CSS()}</style></head>
<body>
<header>
  <div>
    <h1>${escape(basics.name)}<em>${escape(basics.title)}</em></h1>
    ${contactLine(basics)}
  </div>
  ${photo}
</header>
<section><h2>Profile</h2><p class="profile">${rich(cv.profile)}</p></section>
<section><h2>Skills</h2><ul class="skills">${cv.skills
    .map((s) => `<li><strong>${escape(s.label)}:</strong> ${escape(s.items.join(", "))}</li>`)
    .join("")}</ul></section>
<section><h2>Work Experience</h2>${roles}</section>
${projects}
<section class="edu"><h2>Education</h2>${cv.education
    .map(
      (e) =>
        `<div class="row"><span><b>${escape(e.degree)},</b> ${escape(e.school)}</span><span>${escape(e.year)} &nbsp;|&nbsp; ${escape(e.location)}</span></div>`,
    )
    .join("")}</section>
</body></html>`;
}
