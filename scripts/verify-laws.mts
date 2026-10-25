/*
 * Gleicht src/data/*.json mit den HTML-Seiten auf gesetze-im-internet.de ab.
 *
 *   npm run verify-laws               Stichprobe (jede n-te Norm + bekannte Sonderfälle)
 *   npm run verify-laws -- --all      alle Normen (dauert ca. 20 Minuten)
 *
 * Geprüft werden:
 * - Vollständigkeit: Jede Seite im Inhaltsverzeichnis des Gesetzes hat eine Norm im JSON und umgekehrt.
 * - Je Norm: Bezeichnung, Überschrift, Absatztext und amtliche Fußnoten.
 * Bezeichnung und Überschrift werden mit normalisiertem Leerraum verglichen, Absätze und Fußnoten
 * ganz ohne Leerraum, weil HTML und JSON Listen unterschiedlich umbrechen.
 */

import { readFile } from "node:fs/promises";
import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import type { Inline, LawFile, Norm } from "../src/lawTypes.ts";

const BASE_URL = "https://www.gesetze-im-internet.de";
const SAMPLE_SIZE = 40;
const DELAY_MS = 300;

/** Normen mit Listen, Fußnoten, zweizeiligen Überschriften, Bereichen und ohne Überschrift. */
const SPECIAL_CASES: Record<string, string[]> = {
  bgb: ["3", "14", "40", "81", "90a", "114", "279", "308", "309", "312d", "433", "651", "1600", "1615c"],
  hgb: ["1", "8b", "13b", "47a", "153", "257", "264", "377"],
};

const all = process.argv.includes("--all");

async function main(): Promise<void> {
  let checked = 0;
  const failures: string[] = [];
  const fail = (law: LawFile, what: string, problems: string[]): void => {
    failures.push(`${law.abbr} ${what}:\n    ${problems.join("\n    ")}`);
    console.log(`  ✗ ${what}`);
  };

  for (const slug of Object.keys(SPECIAL_CASES)) {
    const law = JSON.parse(await readFile(new URL(`../src/data/${slug}.json`, import.meta.url), "utf8")) as LawFile;

    const missing = await checkCompleteness(slug, law);
    if (missing.length > 0) fail(law, "Vollständigkeit", missing);

    // Zusammengefasste Bereiche ("§§ 3 bis 6") haben eine gemeinsame Seite und werden nur einmal geprüft.
    const pages = new Map<string, Norm>();
    for (const norm of pickNorms(law, SPECIAL_CASES[slug])) pages.set(pageName(norm), norm);
    console.log(`${law.abbr}: prüfe ${pages.size} Seiten für ${law.norms.length} Normen`);

    for (const [page, norm] of pages) {
      const problems = await compare(slug, page, norm);
      checked++;
      if (problems.length > 0) fail(law, norm.range ?? norm.label, problems);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n${checked} Seiten geprüft, ${failures.length} Abweichung(en).`);
  for (const failure of failures) console.log(`- ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

/** Seitenname auf gesetze-im-internet.de: "__433.html", für Bereiche "___3_bis_6.html" bzw. "___13b_u__13c.html". */
function pageName(norm: Norm): string {
  if (!norm.range) return `__${norm.id}.html`;
  return `___${norm.range.replace(/^§§\s*/, "").replace(/[ .]/g, "_")}.html`;
}

async function checkCompleteness(slug: string, law: LawFile): Promise<string[]> {
  const index = parse(await fetchPage(`${BASE_URL}/${slug}/index.html`));
  const onSite = new Set(
    index
      .querySelectorAll("a")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => /^___?[^/]+\.html$/.test(href)),
  );
  const inJson = new Set(law.norms.map(pageName));
  const problems: string[] = [];
  for (const page of onSite) if (!inJson.has(page)) problems.push(`auf der Website, aber nicht im JSON: ${page}`);
  for (const page of inJson) if (!onSite.has(page)) problems.push(`im JSON, aber nicht auf der Website: ${page}`);
  await sleep(DELAY_MS);
  return problems;
}

function pickNorms(law: LawFile, special: string[]): Norm[] {
  if (all) return law.norms;
  const byId = new Map(law.norms.map((n) => [n.id, n]));
  const step = Math.max(1, Math.floor(law.norms.length / SAMPLE_SIZE));
  const picked = new Set<Norm>();
  for (const id of special) {
    const norm = byId.get(id);
    if (norm) picked.add(norm);
    else console.log(`  Sonderfall § ${id} fehlt in ${law.abbr}`);
  }
  for (let i = 0; i < law.norms.length; i += step) picked.add(law.norms[i]);
  return [...picked];
}

async function compare(slug: string, pageFile: string, norm: Norm): Promise<string[]> {
  let html: string;
  try {
    html = await fetchPage(`${BASE_URL}/${slug}/${pageFile}`);
  } catch (error) {
    return [`${pageFile}: ${(error as Error).message}`];
  }
  const page = parse(html);
  // Redaktionelle Fußnoten (z. B. "(+++ Zur Anwendung vgl. … +++)") übernimmt build-laws bewusst nicht.
  // Nur bei weggefallenen Bereichen werden sie gebraucht: Dort steht manchmal allein in ihnen "Weggefallen".
  const editorialNotes = page.querySelectorAll(".jnfussnote").map((note) => note.text);
  for (const note of page.querySelectorAll(".jnfussnote")) note.remove();
  // Fußnotenverweise (*)) stehen im HTML im Text, im JSON nicht.
  for (const ref of page.querySelectorAll("sup")) if (ref.querySelector("a.FnR")) ref.remove();
  // Zeilenumbrüche (z. B. in zweizeiligen Überschriften) sollen nicht zu zusammengeklebten Wörtern werden.
  for (const br of page.querySelectorAll("br")) br.replaceWith(" ");

  const problems: string[] = [];
  const text = (el: HTMLElement | null): string => el?.text ?? "";
  const pageTitle = collapse(text(page.querySelector(".jnentitel")));
  checkCollapsed(problems, "Bezeichnung", norm.range ?? norm.label, text(page.querySelector(".jnenbez")));

  const htmlParagraphs = page
    .querySelectorAll(".jnhtml .jurAbsatz")
    .map((el) => el.text)
    .filter((t) => squash(t) !== "");

  if (norm.repealed) {
    // Ohne Überschrift in der Quelle zeigt die Website "(weggefallen)" oder den Platzhalter "----".
    const actualTitle = /^(\(?weggefallen\)?|-+)$/i.test(pageTitle) ? "" : pageTitle;
    checkCollapsed(problems, "Überschrift", norm.title ?? "", actualTitle);
    const body = squash(htmlParagraphs.join(""));
    if (!/^(\(?weggefallen\)?|-)?$/i.test(body)) problems.push(`als weggefallen markiert, Seite hat Text: ${body.slice(0, 80)}`);
    if (!/weggefallen/i.test(pageTitle + body + editorialNotes.join("")) && !norm.title) {
      problems.push("Seite nennt die Norm nicht weggefallen");
    }
    return problems;
  }

  checkCollapsed(problems, "Überschrift", norm.title ?? "", pageTitle);
  if (/^(\(?weggefallen\)?|-)?$/i.test(squash(htmlParagraphs.join("")))) problems.push("Seite ohne Normtext, aber nicht als weggefallen markiert");

  const jsonParagraphs = norm.paragraphs.map((p) => flatten(p.content));
  if (htmlParagraphs.length !== jsonParagraphs.length) {
    problems.push(`Absatzanzahl: JSON ${jsonParagraphs.length}, HTML ${htmlParagraphs.length}`);
  }
  for (let i = 0; i < Math.min(htmlParagraphs.length, jsonParagraphs.length); i++) {
    checkSquashed(problems, `Absatz ${i + 1}`, jsonParagraphs[i], htmlParagraphs[i]);
  }

  const htmlFootnotes = page.querySelectorAll(".jnhtml dl.footnotes dd").map((el) => el.text);
  checkSquashed(problems, "Fußnoten", (norm.footnotes ?? []).join(""), htmlFootnotes.join(""));
  return problems;
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new TextDecoder("iso-8859-1").decode(await response.arrayBuffer());
}

function flatten(content: Inline[]): string {
  return content
    .map((inline) => (typeof inline === "string" ? inline : inline.items.map((item) => item.label + flatten(item.content)).join("")))
    .join("");
}

function checkCollapsed(problems: string[], what: string, expected: string, actual: string): void {
  report(problems, what, collapse(expected), collapse(actual));
}

function checkSquashed(problems: string[], what: string, expected: string, actual: string): void {
  report(problems, what, squash(expected), squash(actual));
}

function report(problems: string[], what: string, a: string, b: string): void {
  if (a === b) return;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  problems.push(`${what} weicht ab ab Zeichen ${i}:\n      JSON: …${a.slice(Math.max(0, i - 30), i + 50)}\n      HTML: …${b.slice(Math.max(0, i - 30), i + 50)}`);
}

/** Leerraum auf einzelne Leerzeichen reduzieren. */
function collapse(text: string): string {
  return text.replace(/[\s ]+/g, " ").trim();
}

/** Leerraum entfernen, damit nur der Text verglichen wird. */
function squash(text: string): string {
  return text.replace(/[\s ]+/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
