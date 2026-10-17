// M0 spike: render the master CV JSON to PDF and check it stays on one page.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Cv } from "../src/cv/schema.ts";
import { renderCvHtml } from "../src/cv/render-html.ts";
import { htmlToPdf } from "../src/cv/render-pdf.ts";

const cvPath = resolve(process.argv[2] ?? "data/private/cv-master.json");
const cv = Cv.parse(JSON.parse(readFileSync(cvPath, "utf8")));
const photo = cv.basics.photo ? resolve(dirname(cvPath), cv.basics.photo) : undefined;

mkdirSync("out", { recursive: true });
const html = renderCvHtml(cv, photo);
writeFileSync("out/cv-spike.html", html);
await htmlToPdf(html, "out/cv-spike.pdf");

const pages = execFileSync("pdfinfo", ["out/cv-spike.pdf"], { encoding: "utf8" }).match(/^Pages:\s+(\d+)/m)?.[1];
console.log(`out/cv-spike.pdf: ${pages} page(s)`);
