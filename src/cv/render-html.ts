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
};
const icon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

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
.photo { width: 27mm; height: 27mm; border-radius: 50%; object-fit: cover; }
section { margin-top: 3.2mm; }
h2 { font-size: 12.2pt; font-weight: 700; color: #111; border-bottom: 1.4px solid #111; padding-bottom: 0.3mm; margin-bottom: 1.2mm; }
.profile { text-align: justify; }
/* Custom markers (native ones shrink to faint dots at small indents). No positioning: positioned
   boxes are painted in a later layer, which scrambles the PDF text order that ATS parsers read. */
ul { list-style: none; padding-left: 6mm; }
ul.skills { padding-left: 3.2mm; }
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(basics.name)} CV</title>
<style>${CSS()}</style></head>
<body>
<header>
  <div>
    <h1>${escape(basics.name)}<em>${escape(basics.title)}</em></h1>
    <div class="contact">
      <span>${icon("mail")}${escape(basics.email)}</span><span>${icon("phone")}${escape(basics.phone)}</span>
      <span>${icon("linkedin")}${escape(basics.linkedin)}</span><span>${icon("pin")}${escape(basics.location)}</span>
    </div>
  </div>
  ${photo}
</header>
<section><h2>Profile</h2><p class="profile">${rich(cv.profile)}</p></section>
<section><h2>Skills</h2><ul class="skills">${cv.skills
    .map((s) => `<li><strong>${escape(s.label)}:</strong> ${escape(s.items.join(", "))}</li>`)
    .join("")}</ul></section>
<section><h2>Work Experience</h2>${roles}</section>
<section class="edu"><h2>Education</h2>${cv.education
    .map(
      (e) =>
        `<div class="row"><span><b>${escape(e.degree)},</b> ${escape(e.school)}</span><span>${escape(e.year)} &nbsp;|&nbsp; ${escape(e.location)}</span></div>`,
    )
    .join("")}</section>
</body></html>`;
}
