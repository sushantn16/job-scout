import { test } from "node:test";
import assert from "node:assert/strict";
import { mentions, reviewSources } from "../src/research/reviews.ts";

test("a rating or count is found in English or German form, and not inside another number", () => {
  // Snippets as Tavily returned them on 2026-10-24.
  const kununu = "Mitarbeiter haben N26 durchschnittlich mit 3,6 von 5 Punkten bewertet. Anhand von insgesamt 97 Bewertungen";
  const glassdoor = "Employees in Berlin have given N26 a rating of 3.4 out of 5 stars, based on 413 company reviews.";
  assert.ok(mentions(kununu, 3.6, 1));
  assert.ok(mentions(kununu, 97, 0));
  assert.ok(mentions(glassdoor, 3.4, 1));
  assert.ok(mentions(glassdoor, 413, 0));
  assert.ok(mentions("Sehr gut(4-5). 1.545 Bewertungen.", 1545, 0));
  assert.ok(mentions("1,545 reviews", 1545, 0));
  assert.ok(!mentions(kununu, 3.8, 1), "a number the snippet doesn't state");
  assert.ok(!mentions("based on 4130 reviews", 413, 0), "not a prefix of a longer number");
  assert.ok(!mentions("rated 13.4 overall", 3.4, 1), "not the tail of a longer number");
  assert.ok(!mentions("version 3.41", 3.4, 1));
});

test("without a Tavily key nothing is searched", async () => {
  const errors: string[] = [];
  assert.deepEqual(await reviewSources("N26", errors, ""), []);
  assert.deepEqual(errors, []);
});

test("only a company's own review page counts, and averages it's compared with are ignored", async () => {
  const { isCompanyPage, withoutAverages } = await import("../src/research/reviews.ts");
  for (const url of ["https://www.kununu.com/de/number-26", "https://www.kununu.com/at/n265/kommentare"]) assert.ok(isCompanyPage("kununu", url), url);
  // One person's review, not the company's score.
  assert.ok(!isCompanyPage("kununu", "https://www.kununu.com/de/number-26/bewertung/e8b4e021-14ab-448d-8ed3-7f0b7453f609"));
  assert.ok(!isCompanyPage("glassdoor", "https://www.glassdoor.com/Reviews/Employee-Review-ElevenLabs-E9081894-RVW88009755.htm"));
  for (const url of ["https://www.glassdoor.com/Overview/Working-at-ElevenLabs-EI_IE9081894.11,21.htm", "https://www.glassdoor.de/Bewertungen/N26-Bewertungen-E1005428.htm"])
    assert.ok(isCompanyPage("glassdoor", url), url);
  // Returned for Packmatic on 2026-10-24: a ranking list, not its page.
  assert.ok(!isCompanyPage("kununu", "https://www.kununu.com/de/beste-arbeitgeber/druck-verpackung/kmu"));
  assert.ok(!isCompanyPage("glassdoor", "https://www.glassdoor.com/Jobs/Taxfix-Jobs-E1301207.htm"));
  assert.ok(!isCompanyPage("glassdoor", "https://www.kununu.com/de/number-26"), "the site must match");
  // Filtered views, returned for Taxfix and N26 on 2026-10-24.
  assert.ok(!isCompanyPage("kununu", "https://www.kununu.com/de/taxfix1/kommentare?position=student"));
  assert.ok(!isCompanyPage("glassdoor", "https://www.glassdoor.com/Reviews/N26-Berlin-Reviews-EI_IE1032903.0,3_IL.4,10_IC2622109.htm"));
  assert.ok(!isCompanyPage("glassdoor", "https://www.glassdoor.com/Reviews/ElevenLabs-culture-Reviews-EI_IE9081894.0,10_KH11,18.htm"));
  assert.ok(isCompanyPage("glassdoor", "https://www.glassdoor.com/Reviews/Taxfix-Reviews-E1301207.htm"));

  // Returned for N26 on 2026-10-24; the model reported the 3.8 average as N26's score.
  const text = withoutAverages("N26 durchschnittlich mit 3,6 von 5 Punkten bewertet. Dieser Wert liegt unter dem Durchschnitt (3,8 Punkte). Anhand von insgesamt 97 Bewertungen");
  assert.ok(mentions(text, 3.6, 1));
  assert.ok(!mentions(text, 3.8, 1));
  assert.ok(mentions(text, 97, 0));
});
