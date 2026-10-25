/*
 * Seitenbereich: zeigt zur Cursorposition das Zitat und den Normtext an.
 * Unabhängig von Word, damit derselbe Code im Browser-Demo und in Tests läuft.
 */

import { citationAt, findCitations } from "../citationParser";
import type { Citation } from "../citationParser";
import { formatCitation } from "../citationFormat";
import { AVAILABLE_LAWS, LawStore } from "../lawStore";
import type { Lookup } from "../lawStore";
import { nonBreaking, renderNorm } from "../renderNorm";

/** Text des Absatzes, in dem der Cursor steht, und die Cursorposition darin. */
export interface CursorText {
  text: string;
  offset: number;
}

/**
 * Woher das Gesetz eines Zitats kommt: angegeben, aus einem früheren Zitat im selben Absatz,
 * angenommen (erstes enthaltenes Gesetz mit dieser Norm) oder vom Nutzer per Knopf gewählt.
 */
type LawSource = "stated" | "context" | "guess" | "chosen";

type NormLookup = Extract<Lookup, { kind: "norm" }>;

interface Resolved {
  citation: Citation;
  source: LawSource;
  lookup: Lookup;
  /** Enthaltene Gesetze, in denen es die Norm (nicht weggefallen) gibt; für die Umschaltknöpfe. */
  options: { law: string; lookup: NormLookup }[];
  /** Schlüssel für die Wahl per Knopf, damit sie bei Cursorbewegungen im selben Zitat bleibt. */
  choiceKey: string;
}

/** Seiten auf gesetze-im-internet.de, deren Name nicht einfach das kleingeschriebene Kürzel ist. */
const LAW_SLUGS: Record<string, string> = {
  EGBGB: "bgbeg",
  EGHGB: "hgbeg",
  UWG: "uwg_2004",
  AO: "ao_1977",
  StVO: "stvo_2013",
  BDSG: "bdsg_2018",
  BauGB: "bbaug",
  WEG: "woeigg",
  VVG: "vvg_2008",
};
/** EU-Recht steht nicht auf gesetze-im-internet.de. */
const EU_LAWS = new Set(["DSGVO", "DS-GVO", "AEUV", "EUV", "GRCh", "EMRK", "EG", "EGV"]);

export class CitationPanel {
  private readonly store: LawStore;
  private readonly status: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly content: HTMLElement;
  private request = 0;
  /** Schlüssel des angezeigten Inhalts, damit ein gleiches Zitat nicht neu gezeichnet wird. */
  private shown?: string;
  /** Ob schon eine Norm oder Meldung statt der Anleitung zu sehen ist. */
  private showing = false;
  /** Per Knopf gewählte Gesetze für Zitate ohne Gesetzesangabe. */
  private readonly choices = new Map<string, string>();

  constructor(root: HTMLElement, store: LawStore) {
    this.store = store;
    root.replaceChildren();
    this.status = append(root, "div", "panel-status");
    this.status.setAttribute("role", "status");
    this.notes = append(root, "div", "panel-notes");
    this.content = append(root, "div", "panel-content");
    this.showIntro();
  }

  /** Aktualisiert die Anzeige für eine Cursorposition; `null`, wenn kein Text gelesen werden konnte. */
  async showCursor(cursor: CursorText | null): Promise<void> {
    const request = ++this.request;
    const found = cursor ? citationAt(cursor.text, cursor.offset) : undefined;
    if (!cursor || !found) {
      this.setStatus(this.showing ? "Zuletzt angezeigt" : "Kein Zitat am Cursor", true);
      return;
    }
    this.setStatus(formatCitation(found), false);

    let resolved: Resolved;
    try {
      resolved = await this.resolve(cursor.text, found);
    } catch (error) {
      if (request === this.request)
        this.showProblem(`Das Gesetz konnte nicht geladen werden: ${(error as Error).message}`);
      return;
    }
    if (request !== this.request) return;
    const key = `${formatCitation(resolved.citation)}|${resolved.source}`;
    if (key !== this.shown) this.render(resolved);
  }

  /** Zeigt ein Problem an, z. B. wenn Word den Text nicht liefert; `status` ersetzt dann auch die Statuszeile. */
  showProblem(text: string, status?: string): void {
    if (status) this.setStatus(status, true);
    this.shown = undefined;
    this.showing = true;
    this.notes.replaceChildren();
    this.content.replaceChildren(el("p", "panel-message", text));
  }

  /** Bestimmt Gesetz und Norm; wirft, wenn ein benötigtes Gesetz nicht geladen werden konnte. */
  private async resolve(text: string, found: Citation): Promise<Resolved> {
    const choiceKey = `${found.groupStart}:${found.start}:${text}`;
    const isParagraph = found.unit === "§" && !found.article;
    const options = isParagraph && !found.law && !found.lawText ? await this.liveIn(found) : [];
    const result = (citation: Citation, source: LawSource, lookup: Lookup): Resolved => ({
      citation,
      source,
      lookup,
      options,
      choiceKey,
    });

    if (found.law || found.lawText) return result(found, "stated", await this.store.lookup(found));

    const chosen = options.find((o) => o.law === this.choices.get(choiceKey));
    if (chosen) return result({ ...found, law: chosen.law }, "chosen", chosen.lookup);

    // Das zuletzt im selben Absatz genannte Gesetz derselben Art (Paragraf oder Artikel), auch wenn es nicht enthalten ist.
    const kind = (c: Citation): string => (c.unit === "Art" ? "Art" : c.article ? "Art§" : "§");
    const earlier = findCitations(text)
      .filter(
        (c) => c.groupEnd <= found.groupStart && (c.law || c.lawText) && kind(c) === kind(found)
      )
      .pop();
    if (earlier) {
      const citation = {
        ...found,
        law: earlier.law,
        lawText: earlier.law ? undefined : earlier.lawText,
      };
      const lookup = await this.store.lookup(citation);
      // Gibt es die Norm im Kontextgesetz nicht (oder nur weggefallen), lieber in den enthaltenen Gesetzen suchen.
      const usable =
        lookup.kind === "unavailable" || (lookup.kind === "norm" && !lookup.norm.repealed);
      if (usable || options.length === 0) return result(citation, "context", lookup);
    }

    const guess = options[0] ?? (await this.repealedIn(found));
    if (guess) return result({ ...found, law: guess.law }, "guess", guess.lookup);
    return result(found, "stated", { kind: "no-law" });
  }

  /**
   * Enthaltene Gesetze, in denen es die Norm gibt und sie nicht weggefallen ist.
   * Ladefehler werden weitergegeben, wenn dadurch kein Ergebnis bleibt.
   */
  private async liveIn(citation: Citation): Promise<{ law: string; lookup: NormLookup }[]> {
    const found: { law: string; lookup: NormLookup }[] = [];
    let failure: unknown;
    for (const law of Object.keys(AVAILABLE_LAWS)) {
      try {
        const lookup = await this.store.lookup({ ...citation, law });
        if (lookup.kind === "norm" && !lookup.norm.repealed) found.push({ law, lookup });
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure && found.length === 0) throw failure;
    return found;
  }

  /** Falls die Norm nirgends gilt: das erste enthaltene Gesetz, in dem sie weggefallen ist. */
  private async repealedIn(
    citation: Citation
  ): Promise<{ law: string; lookup: NormLookup } | undefined> {
    for (const law of Object.keys(AVAILABLE_LAWS)) {
      const lookup = await this.store.lookup({ ...citation, law });
      if (lookup.kind === "norm") return { law, lookup };
    }
    return undefined;
  }

  private render(resolved: Resolved, focusSwitch = false): void {
    const { citation, source, lookup } = resolved;
    this.shown = `${formatCitation(citation)}|${source}`;
    this.showing = true;
    this.notes.replaceChildren();
    this.addSourceNote(resolved, focusSwitch);

    const unit = citation.unit === "Art" ? "Art." : "§";
    switch (lookup.kind) {
      case "norm": {
        if (citation.oldVersion)
          this.addNote("Das Zitat nennt eine alte Fassung (a.F.); angezeigt wird die aktuelle.");
        if (citation.following) {
          const which =
            citation.following === "f" ? "die folgende Norm ist" : "die folgenden Normen sind";
          this.addNote(
            `Angezeigt wird ${unit} ${citation.section}; ${which} mitgemeint („${citation.following}.“).`
          );
        }
        if (citation.rangeTo && !lookup.norm.range) {
          this.addNote(
            `Bereich bis ${unit} ${citation.rangeTo}: angezeigt wird der Anfang, ${unit} ${citation.section}.`
          );
        }
        const article = renderNorm(lookup.law.file, lookup.norm, { citation });
        this.content.replaceChildren(article);
        this.scrollToCited(article);
        return;
      }
      case "missing":
        this.content.replaceChildren(
          el(
            "p",
            "panel-message",
            `${unit} ${citation.section} gibt es im ${lookup.law.file.abbr} nicht.`
          )
        );
        return;
      case "unavailable":
        this.showUnavailable(citation, lookup);
        return;
      case "no-law": {
        const text =
          citation.unit === "Art"
            ? "Kein Gesetz angegeben. BGB und HGB haben keine Artikel."
            : `Kein Gesetz angegeben, und weder im BGB noch im HGB gibt es § ${citation.section}.`;
        this.content.replaceChildren(el("p", "panel-message", text));
        return;
      }
    }
  }

  /** Hinweis, woher das Gesetz kommt, mit Knöpfen für die anderen enthaltenen Gesetze. */
  private addSourceNote(resolved: Resolved, focusSwitch: boolean): void {
    const { citation, source } = resolved;
    const law = citation.law ?? citation.lawText;
    const reason = { context: "aus dem Zusammenhang", guess: "angenommen", chosen: "gewählt" }[
      source as Exclude<LawSource, "stated">
    ];
    if (!reason) return;
    const note = this.addNote(`Kein Gesetz angegeben – ${reason}: ${law}.`);
    for (const option of resolved.options.filter((o) => o.law !== citation.law)) {
      const button = el(
        "button",
        "panel-switch",
        nonBreaking(`§ ${citation.section} ${option.law} anzeigen`)
      );
      button.type = "button";
      button.addEventListener("click", () => {
        this.choices.set(resolved.choiceKey, option.law);
        this.render(
          {
            ...resolved,
            citation: { ...citation, law: option.law },
            source: "chosen",
            lookup: option.lookup,
          },
          true
        );
      });
      note.append(" ", button);
      if (focusSwitch) button.focus();
      focusSwitch = false;
    }
  }

  private showUnavailable(
    citation: Citation,
    lookup: Extract<Lookup, { kind: "unavailable" }>
  ): void {
    const available = Object.keys(AVAILABLE_LAWS).join(" und ");
    const message = el("div", "panel-message");
    const name = lookup.law ?? (lookup.lawText ? `„${lookup.lawText}“` : "Dieses Gesetz");
    const why = citation.article ? `Artikel ${citation.article} § ${citation.section}` : name;
    message.append(
      el(
        "p",
        undefined,
        `${why} ist nicht enthalten. Das Add-in bringt den Text von ${available} mit.`
      )
    );
    const url = lookup.law ? externalUrl(lookup.law, citation) : undefined;
    if (url) {
      const link = el(
        "a",
        undefined,
        `${formatCitation({ ...citation, pinpoints: [] })} auf gesetze-im-internet.de öffnen`
      );
      link.setAttribute("href", url);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
      const p = el("p");
      p.append(link);
      message.append(p);
    }
    this.content.replaceChildren(message);
  }

  /** Scrollt nur den Inhaltsbereich so, dass die innerste zitierte Stelle zu sehen ist. */
  private scrollToCited(article: HTMLElement): void {
    this.content.scrollTop = 0;
    const cited = article.querySelector<HTMLElement>(".cited");
    if (!cited) return;
    const box = this.content.getBoundingClientRect();
    const target = cited.getBoundingClientRect();
    if (target.bottom > box.bottom || target.top < box.top) {
      this.content.scrollTop = Math.max(0, target.top - box.top - 24);
    }
  }

  private setStatus(text: string, idle: boolean): void {
    this.status.textContent = text;
    this.status.title = text;
    this.status.classList.toggle("idle", idle);
  }

  private addNote(text: string): HTMLElement {
    return append(this.notes, "p", "panel-note", text);
  }

  private showIntro(): void {
    this.setStatus("Kein Zitat ausgewählt", true);
    const intro = el("div", "panel-intro");
    intro.append(
      el(
        "p",
        undefined,
        nonBreaking(
          "Setze den Cursor in ein Normzitat, z. B. „§ 433 Abs. 1 BGB“ oder „§§ 280 I, 241 II BGB“."
        )
      ),
      el(
        "p",
        undefined,
        "Hier erscheint dann der Text der Norm; die zitierten Absätze und Nummern sind hervorgehoben."
      ),
      el("p", "panel-intro-laws", `Enthalten: ${Object.keys(AVAILABLE_LAWS).join(", ")}`)
    );
    this.content.replaceChildren(intro);
  }
}

/** Seite einer nicht enthaltenen Norm auf gesetze-im-internet.de, soweit sich die Adresse ableiten lässt. */
function externalUrl(law: string, citation: Citation): string | undefined {
  if (EU_LAWS.has(law) || citation.article || !/^[\p{L}-]+$/u.test(law)) return undefined;
  const slug = LAW_SLUGS[law] ?? law.toLowerCase();
  const page = citation.unit === "Art" ? `art_${citation.section}` : `__${citation.section}`;
  return `https://www.gesetze-im-internet.de/${slug}/${page}.html`;
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

function append<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = el(tag, className, text);
  parent.append(element);
  return element;
}
