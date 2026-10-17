// Render a CV to a one-page PDF: measure the print layout and drop the least relevant bullets until it fits.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import type { Cv } from "../cv/schema.ts";
import { renderCvHtml } from "../cv/render-html.ts";
import { browserChannel } from "../cv/render-pdf.ts";

const MM = 96 / 25.4;
// A4 minus the template's @page margins (14mm sides, 10mm top and bottom).
const PRINT_WIDTH = Math.floor((210 - 28) * MM);
const PRINT_HEIGHT = Math.floor((297 - 20) * MM);

/** Bullets are listed most relevant first, so trimming takes from the end of the longest role. Each role keeps one. */
function dropOne(cv: Cv): { cv: Cv; dropped: string } | null {
  const role = [...cv.experience].sort((a, b) => b.bullets.length - a.bullets.length)[0];
  if (!role || role.bullets.length <= 1) return null;
  const dropped = role.bullets[role.bullets.length - 1]!.id;
  return { cv: { ...cv, experience: cv.experience.map((r) => (r.id === role.id ? { ...r, bullets: r.bullets.slice(0, -1) } : r)) }, dropped };
}

/** Bullets the tailor left out, as candidates to add back: current role first, each role in master order. */
function leftOut(cv: Cv, master: Cv): { roleId: string; bullet: Cv["experience"][number]["bullets"][number] }[] {
  return master.experience.flatMap((m) => {
    const shown = new Set(cv.experience.find((r) => r.id === m.id)?.bullets.map((b) => b.id));
    return m.bullets.filter((b) => !shown.has(b.id)).map((bullet) => ({ roleId: m.id, bullet }));
  });
}

const withBullet = (cv: Cv, roleId: string, bullet: Cv["experience"][number]["bullets"][number]): Cv => ({
  ...cv,
  experience: cv.experience.map((r) => (r.id === roleId ? { ...r, bullets: [...r.bullets, bullet] } : r)),
});

/**
 * Fit to one page: trim the least relevant bullets while it overflows; if it fits with room to spare and `master` is
 * given, add left-out bullets back (appended, as the least relevant) while they still fit.
 */
export async function renderOnePage(cv: Cv, photoPath: string | undefined, outPath: string, master?: Cv): Promise<{ cv: Cv; dropped: string[]; added: string[]; pages: number }> {
  const browser = await chromium.launch({ channel: browserChannel() });
  try {
    const page = await browser.newPage({ viewport: { width: PRINT_WIDTH, height: PRINT_HEIGHT } });
    await page.emulateMedia({ media: "print" });
    const fits = async (c: Cv) => {
      await page.setContent(renderCvHtml(c, photoPath), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      return (await page.evaluate(() => document.body.getBoundingClientRect().height)) <= PRINT_HEIGHT;
    };
    const dropped: string[] = [];
    const added: string[] = [];
    let current = cv;
    while (!(await fits(current))) {
      const next = dropOne(current);
      if (!next) break;
      current = next.cv;
      dropped.push(next.dropped);
    }
    if (master && dropped.length === 0) {
      for (const { roleId, bullet } of leftOut(current, master)) {
        const candidate = withBullet(current, roleId, bullet);
        if (await fits(candidate)) (current = candidate), added.push(bullet.id);
      }
    }
    // Lay out the final version again before printing (the last measurement may have been a rejected candidate).
    await fits(current);
    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    writeFileSync(outPath, pdf);
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    return { cv: current, dropped, added, pages };
  } finally {
    await browser.close();
  }
}
