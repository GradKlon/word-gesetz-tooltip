/*
 * Lädt Gesetze als XML von gesetze-im-internet.de und schreibt sie als JSON nach src/data/.
 *
 *   npm run build-laws
 *
 * Bewusst nicht übernommen: redaktionelle Fußnoten der Dokumentation (<fussnoten>, z. B.
 * "(+++ Zur Anwendung vgl. … +++)"), Textauszeichnung (kursiv, fett) und Fußnotenzeichen im Text.
 *
 * Gesetze sind amtliche Werke und nach § 5 UrhG gemeinfrei.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import type { Element, Node } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import type { Inline, LawFile, List, Norm, Paragraph, Section } from "../src/lawTypes.ts";

const BASE_URL = "https://www.gesetze-im-internet.de";
const OUT_DIR = new URL("../src/data/", import.meta.url);

/** Gesetzeskürzel → Pfad auf gesetze-im-internet.de. */
const LAWS: Record<string, string> = {
  BGB: "bgb",
  HGB: "hgb",
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Text oder Überschrift einer aufgehobenen Norm: "(weggefallen)" oder "-". */
const REPEALED_TEXT = /^(\(?weggefallen\)?|-)$/i;

/** Reine Formatierung: Text wird übernommen, die Auszeichnung verworfen. */
const FORMATTING_TAGS = new Set(["B", "I", "U", "SP", "NB", "SUP", "SUB", "small", "noindex", "LA", "DD", "P", "Content"]);

let warnings = 0;
function warn(message: string): void {
  warnings++;
  console.warn(`  Warnung: ${message}`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const [abbr, slug] of Object.entries(LAWS)) {
    console.log(`${abbr}: lade ${BASE_URL}/${slug}/xml.zip`);
    const xml = await download(slug);
    const law = parseLaw(xml, abbr, slug);
    const file = new URL(`${slug}.json`, OUT_DIR);
    await writeFile(file, stringifyLaw(law));
    const repealed = law.norms.filter((n) => n.repealed).length;
    console.log(`${abbr}: ${law.norms.length} Normen (davon ${repealed} weggefallen), ${law.sections.length} Gliederungsebenen → src/data/${slug}.json`);
  }
  if (warnings > 0) console.warn(`${warnings} Warnung(en).`);
}

async function download(slug: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/${slug}/xml.zip`);
  if (!response.ok) throw new Error(`Download fehlgeschlagen: HTTP ${response.status}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const xmlNames = Object.keys(files).filter((name) => name.endsWith(".xml"));
  if (xmlNames.length !== 1) throw new Error(`Erwartet genau eine XML-Datei im ZIP, gefunden: ${xmlNames.join(", ")}`);
  return strFromU8(files[xmlNames[0]]);
}

function parseLaw(xml: string, abbr: string, slug: string): LawFile {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  if (!root || root.tagName !== "dokumente") throw new Error("Unerwartetes XML: <dokumente> fehlt");

  const law: LawFile = {
    abbr,
    title: "",
    stand: [],
    builddate: root.getAttribute("builddate") ?? "",
    source: `${BASE_URL}/${slug}/`,
    sections: [],
    norms: [],
  };
  const seenIds = new Set<string>();
  // Offene Gliederungsebenen; die Ebene ergibt sich aus der Länge der Gliederungskennzahl (3 Ziffern je Ebene).
  const sectionStack: { level: number; index: number }[] = [];

  for (const normEl of childElements(root, "norm")) {
    const meta = childElement(normEl, "metadaten");
    if (!meta) continue;

    const textdaten = childElement(normEl, "textdaten");
    const textEl = textdaten && childElement(textdaten, "text");
    const content = textEl && childElement(textEl, "Content");
    const footnotes = textEl ? parseFootnotes(textEl) : [];

    // Die erste Norm trägt die Angaben zum ganzen Gesetz.
    const langTitle = childElement(meta, "langue");
    if (langTitle && !law.title) {
      law.title = collapse(langTitle.textContent ?? "");
      for (const stand of childElements(meta, "standangabe")) {
        const comment = childElement(stand, "standkommentar");
        if (comment) law.stand.push(collapse(comment.textContent ?? ""));
      }
      const preamble = content ? parseParagraphs(content) : [];
      if (preamble.length > 0) law.preamble = preamble;
    }

    const gliederung = childElement(meta, "gliederungseinheit");
    if (gliederung) {
      const code = childText(gliederung, "gliederungskennzahl");
      const level = code.length / 3;
      while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) sectionStack.pop();
      const section: Section = {
        bez: childText(gliederung, "gliederungsbez"),
        title: inlineText(childElement(gliederung, "gliederungstitel")),
        ...(sectionStack.length > 0 ? { parent: sectionStack[sectionStack.length - 1].index } : {}),
        ...(footnotes.length > 0 ? { footnotes } : {}),
      };
      law.sections.push(section);
      sectionStack.push({ level, index: law.sections.length - 1 });
      continue;
    }

    const enbez = childText(meta, "enbez");
    if (!enbez || enbez === "Inhaltsübersicht") continue;

    const ids = parseEnbez(enbez);
    if (!ids || ids.length === 0) {
      warn(`${abbr}: Normbezeichnung "${enbez}" nicht auflösbar, übersprungen`);
      continue;
    }
    // "(XXXX) §§ 3 bis 6" → "§§ 3 bis 6"; zusammengefasste Bereiche sind immer weggefallen.
    const range = ids.length > 1 ? enbez.replace(/^\(XXXX\)\s*/, "") : undefined;

    const title = inlineText(childElement(meta, "titel"));
    const paragraphs = content ? parseParagraphs(content) : [];
    const repealed =
      range !== undefined || REPEALED_TEXT.test(title) || paragraphs.every((p) => REPEALED_TEXT.test(toPlainText(p.content)));
    // Bei weggefallenen Normen bleibt die Überschrift nur, wenn sie mehr sagt, z. B. "(jetzt § 650)" bei § 651 BGB.
    const keepTitle = title && !(repealed && REPEALED_TEXT.test(title));
    const section = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].index : undefined;

    for (const id of ids) {
      if (seenIds.has(id)) {
        warn(`${abbr}: § ${id} kommt doppelt vor, zweites Vorkommen übersprungen`);
        continue;
      }
      seenIds.add(id);
      const norm: Norm = {
        id,
        label: `§ ${id}`,
        ...(range ? { range } : {}),
        ...(keepTitle ? { title } : {}),
        ...(section !== undefined ? { section } : {}),
        ...(repealed ? { repealed: true as const } : {}),
        paragraphs: repealed ? [] : paragraphs,
        ...(footnotes.length > 0 && !repealed ? { footnotes } : {}),
      };
      law.norms.push(norm);
    }
  }

  if (!law.title) warn(`${abbr}: Langtitel fehlt`);
  return law;
}

/**
 * Wandelt die Normbezeichnung in Schlüssel um:
 *   "§ 433" → ["433"], "(XXXX) §§ 3 bis 6" → ["3", "4", "5", "6"], "(XXXX) §§ 1 und 2" → ["1", "2"].
 */
function parseEnbez(enbez: string): string[] | null {
  const single = /^§\s*(\d+[a-z]*)$/.exec(enbez);
  if (single) return [single[1]];

  const range = /^(?:\(XXXX\))?\s*§§\s*(\d+[a-z]*)\s*(bis|und|u\.)\s*(\d+[a-z]*)$/.exec(enbez);
  if (!range) return null;
  const [, from, connector, to] = range;
  if (connector !== "bis") return [from, to];

  const [, fromNum, fromLetter] = /^(\d+)([a-z]?)$/.exec(from) ?? [];
  const [, toNum, toLetter] = /^(\d+)([a-z]?)$/.exec(to) ?? [];
  const sameNumber = fromNum === toNum;
  if (
    !fromNum ||
    !toNum ||
    Number(toNum) < Number(fromNum) ||
    (sameNumber && (!toLetter || (fromLetter && fromLetter >= toLetter)))
  ) {
    warn(`Bereich "${enbez}" nicht auflösbar, nur die Endpunkte werden übernommen`);
    return [from, to];
  }
  const letters = (first: string, last: string): string[] => {
    const result: string[] = [];
    for (let c = first.charCodeAt(0); c <= last.charCodeAt(0); c++) result.push(String.fromCharCode(c));
    return result;
  };
  // "§§ 1615b bis 1615k": nur Buchstaben laufen hoch. Bei "§§ 5 bis 5b" gehört "5" selbst dazu.
  if (sameNumber) return [...(fromLetter ? [] : [from]), ...letters(fromLetter || "a", toLetter).map((l) => fromNum + l)];
  // "§§ 38 bis 47b": alle Zahlen, am Ende zusätzlich "47a" und "47b".
  // Buchstabenparagrafen dazwischen (etwa "§ 39a") sind nicht erkennbar und fehlen.
  const ids: string[] = [from];
  for (let n = Number(fromNum) + 1; n <= Number(toNum); n++) ids.push(String(n));
  if (toLetter) ids.push(...letters("a", toLetter).map((l) => toNum + l));
  return ids;
}

function parseParagraphs(content: Element): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const p of childElements(content, "P")) {
    const inlines = parseInlines(p);
    if (inlines.length === 0) continue;
    const first = inlines[0];
    const num = typeof first === "string" ? /^\((\d+[a-z]?)\)/.exec(first) : null;
    paragraphs.push(num ? { num: num[1], content: inlines } : { content: inlines });
  }
  return paragraphs;
}

function parseFootnotes(textEl: Element): string[] {
  const container = childElement(textEl, "Footnotes");
  if (!container) return [];
  return childElements(container, "Footnote")
    .map((footnote) => toPlainText(parseInlines(footnote)))
    .filter((text) => text.length > 0);
}

/** Text eines Elements, <BR> wird zu "\n". Für Überschriften, die Zeilenumbrüche enthalten können. */
function inlineText(el: Element | undefined): string {
  return el ? toPlainText(parseInlines(el)) : "";
}

/** Inlines als reiner Text; Listenpunkte stehen jeweils in einer eigenen Zeile ("1. …"). */
function toPlainText(content: Inline[]): string {
  return content
    .map((inline) =>
      typeof inline === "string" ? inline : inline.items.map((item) => `${item.label} ${toPlainText(item.content)}`.trim()).join("\n"),
    )
    .join("\n");
}

/** Wandelt gemischten Inhalt (Text, Formatierung, Aufzählungen) in eine Liste von Inlines um. */
function parseInlines(el: Element): Inline[] {
  const out: Inline[] = [];
  let buffer = "";

  const flush = (): void => {
    const text = cleanText(buffer);
    if (text) out.push(text);
    buffer = "";
  };

  const walk = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) {
      buffer += (node.nodeValue ?? "").replace(/\s+/g, " ");
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const child = node as Element;
    switch (child.tagName) {
      case "BR":
        buffer += "\n";
        return;
      case "FnR":
        return;
      case "DL":
        flush();
        out.push(parseList(child));
        return;
      case "LA":
        // Mehrere Absätze innerhalb eines Listenpunkts (z. B. "(Nachfrist)" + Text in § 308 BGB).
        if (buffer.trim()) buffer += "\n";
        walkChildren(child);
        return;
      default:
        if (!FORMATTING_TAGS.has(child.tagName)) warn(`unbekanntes Element <${child.tagName}>, nur Text übernommen`);
        walkChildren(child);
    }
  };
  const walkChildren = (parent: Element): void => {
    for (let c = parent.firstChild; c; c = c.nextSibling) walk(c);
  };

  walkChildren(el);
  flush();
  return out;
}

function parseList(dl: Element): List {
  const list: List = { list: dl.getAttribute("Type") || "arabic", items: [] };
  let label = "";
  for (const child of childElements(dl)) {
    if (child.tagName === "DT") {
      label = collapse(child.textContent ?? "");
    } else if (child.tagName === "DD") {
      list.items.push({ label, content: parseInlines(child) });
      label = "";
    }
  }
  return list;
}

/** Leerraum vereinheitlichen, Zeilenumbrüche aus <BR> erhalten. */
function cleanText(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function childElements(parent: Element, tagName?: string): Element[] {
  const result: Element[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === ELEMENT_NODE && (!tagName || (c as Element).tagName === tagName)) result.push(c as Element);
  }
  return result;
}

function childElement(parent: Element, tagName: string): Element | undefined {
  return childElements(parent, tagName)[0];
}

function childText(parent: Element, tagName: string): string {
  const el = childElement(parent, tagName);
  return el ? collapse(el.textContent ?? "") : "";
}

/** JSON mit einer Zeile pro Norm bzw. Gliederungsebene, damit Änderungen in Git-Diffs lesbar bleiben. */
function stringifyLaw(law: LawFile): string {
  const { sections, norms, ...head } = law;
  const headLines = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  const block = (key: string, items: unknown[]): string =>
    `  ${JSON.stringify(key)}: [\n${items.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`;
  return `{\n${headLines.join("\n")}\n${block("sections", sections)},\n${block("norms", norms)}\n}\n`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
