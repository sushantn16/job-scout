import { chromium } from "playwright-core";

/** Installed Google Chrome by default (no download needed on the Mac); JOB_SCOUT_CHROME_CHANNEL="" uses Playwright's bundled
 * Chromium instead, as in the Docker image. */
export const browserChannel = () => {
  const c = process.env.JOB_SCOUT_CHROME_CHANNEL;
  return c === undefined ? "chrome" : c || undefined;
};

export async function htmlToPdf(html: string, outPath: string): Promise<void> {
  const browser = await chromium.launch({ channel: browserChannel() });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: outPath, format: "A4", preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close();
  }
}
