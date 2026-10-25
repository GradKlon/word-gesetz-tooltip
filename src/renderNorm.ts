/*
 * Stellt eine Norm als HTML dar und hebt die zitierten Absätze, Nummern und Buchstaben hervor.
 */

import type { Citation } from "./citationParser";
import { normUrl, sectionPath } from "./lawStore";
import type { Inline, LawFile, List, Norm, Paragraph } from "./lawTypes";

export interface RenderOptions {
  /** Das Zitat, dessen Stellen hervorgehoben werden. */
  citation?: Citation;
  /** Schreibt Fließtext in ein Element; Standard: Text mit Zeilenumbrüchen. Hier hängen später die Verweis-Tooltips an. */
  renderText?: (text: string, into: HTMLElement) => void;
}

/** Geschütztes Leerzeichen zwischen "§", "Abs.", "Buch" usw. und der folgenden Zahl, damit dort nicht umbrochen wird. */
export function nonBreaking(text: string): string {
  return text.replace(
    /(§§?|Art\.|Artikel|Abs\.|Absatz|Absätze|Nr\.|Nummer|Nummern|S\.|Satz|Sätze|Buchstabe|Buch|Teil|Abschnitt|Unterabschnitt|Titel|Untertitel|Kapitel) (?=[\dIVX])/g,
    "$1\u00a0"
  );
}

/** Fließtext mit "\n" als Zeilenumbruch. */
export function appendText(text: string, into: HTMLElement): void {
  nonBreaking(text)
    .split("\n")
    .forEach((line, i) => {
      if (i > 0) into.append(document.createElement("br"));
      into.append(line);
    });
}

export function renderNorm(law: LawFile, norm: Norm, options: RenderOptions = {}): HTMLElement {
  const renderText = options.renderText ?? appendText;
  const pinpoints = options.citation?.pinpoints ?? [];
  const article = el("article", "norm");

  const path = sectionPath(law, norm);
  if (path.length > 0) {
    const nav = el("nav", "norm-path");
    nav.setAttribute("aria-label", "Gliederung");
    nav.title = path.map((s) => `${s.bez}: ${s.title}`).join("\n");
    nav.append(el("span", "norm-path-bez", path.map((s) => nonBreaking(s.bez)).join(" › ")));
    nav.append(el("span", "norm-path-title", path[path.length - 1].title.replace(/\n/g, " – ")));
    article.append(nav);
  }

  const header = el("header", "norm-header");
  const heading = el("h2", "norm-heading");
  heading.append(
    el("span", "norm-label", norm.repealed && norm.range ? norm.range : norm.label),
    " "
  );
  heading.append(el("span", "norm-law", law.abbr));
  header.append(heading);
  if (norm.title) {
    const title = el("p", "norm-title");
    appendText(norm.title, title);
    header.append(title);
  }
  article.append(header);

  if (norm.repealed) {
    article.append(
      el(
        "p",
        "norm-repealed",
        norm.range ? `${norm.range} sind weggefallen.` : `${norm.label} ist weggefallen.`
      )
    );
  } else {
    const body = el("div", "norm-text");
    for (const paragraph of norm.paragraphs)
      body.append(renderParagraph(paragraph, norm, pinpoints, renderText));
    markInnermost(body);
    article.append(body);
  }

  if (norm.footnotes?.length) {
    const notes = el("aside", "norm-footnotes");
    for (const note of norm.footnotes) {
      const p = el("p");
      appendText(note, p);
      notes.append(p);
    }
    article.append(notes);
  }

  const source = el("footer", "norm-source");
  const link = el("a", undefined, "gesetze-im-internet.de");
  link.setAttribute("href", normUrl(law, norm));
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener");
  source.append("Quelle: ", link);
  const stand = law.stand.find((s) => /zuletzt geändert/i.test(s)) ?? law.stand[0];
  if (stand) source.append(el("span", "norm-stand", ` · ${stand}`));
  article.append(source);
  return article;
}

function renderParagraph(
  paragraph: Paragraph,
  norm: Norm,
  pinpoints: Citation["pinpoints"],
  renderText: NonNullable<RenderOptions["renderText"]>
): HTMLElement {
  const div = el("div", "absatz");
  if (paragraph.num) div.dataset.absatz = paragraph.num;
  // Ohne Absatznummern (z. B. § 90a BGB) gilt eine Nummer im Zitat für die ganze Norm.
  const relevant = pinpoints.filter(
    (p) => !p.absatz || p.absatz === paragraph.num || !norm.paragraphs.some((x) => x.num)
  );
  if (paragraph.num && pinpoints.some((p) => p.absatz === paragraph.num))
    div.classList.add("cited");
  renderInlines(paragraph.content, div, relevant, 0, renderText);
  return div;
}

function renderInlines(
  content: Inline[],
  into: HTMLElement,
  pinpoints: Citation["pinpoints"],
  depth: number,
  renderText: NonNullable<RenderOptions["renderText"]>
): void {
  for (const inline of content) {
    if (typeof inline === "string") {
      const span = el("span", "text");
      renderText(inline, span);
      into.append(span);
    } else {
      into.append(renderList(inline, pinpoints, depth, renderText));
    }
  }
}

/** Aufzählung; auf der ersten Ebene zählt die Nummer ("2."), darunter der Buchstabe ("a)"). */
function renderList(
  list: List,
  pinpoints: Citation["pinpoints"],
  depth: number,
  renderText: NonNullable<RenderOptions["renderText"]>
): HTMLElement {
  const ol = el("ol", "liste");
  for (const item of list.items) {
    const li = el("li", "listenpunkt");
    li.dataset.label = item.label;
    // Erste Ebene: Nummern ("2."), in manchen Normen aber direkt Buchstaben ("a)", z. B. § 1760 Abs. 2 BGB).
    const matching = pinpoints.filter((p) =>
      depth === 0 && p.nr !== undefined
        ? item.label === `${p.nr}.`
        : p.buchstabe !== undefined && item.label === `${p.buchstabe})`
    );
    if (matching.length > 0) li.classList.add("cited");
    li.append(el("span", "listenpunkt-label", item.label));
    const text = el("div", "listenpunkt-text");
    // Buchstaben nur innerhalb der zitierten Nummer hervorheben.
    renderInlines(item.content, text, depth === 0 ? matching : [], depth + 1, renderText);
    li.append(text);
    ol.append(li);
  }
  return ol;
}

/**
 * Nur die innerste zitierte Stelle bleibt "cited" (volle Hervorhebung, für Screenreader angesagt);
 * umgebende Absätze und Nummern werden "cited-context" (nur Randmarkierung).
 */
function markInnermost(body: HTMLElement): void {
  for (const element of body.querySelectorAll(".cited")) {
    if (element.querySelector(".cited")) element.classList.replace("cited", "cited-context");
  }
  for (const element of body.querySelectorAll(".cited")) {
    element.prepend(el("span", "visually-hidden", "Zitiert: "));
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
