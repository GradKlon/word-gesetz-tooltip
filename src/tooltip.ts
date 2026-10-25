/*
 * Paradox-Tooltips (wie in Crusader Kings 3 oder Victoria 3) für Verweise im Normtext.
 *
 * - Verweise im Normtext ("§ 280 Abs. 1", "§ 377 HGB") werden zu hoverbaren span.ref.
 * - Bleibt die Maus kurz auf einem Verweis (delay), erscheint ein Tooltip mit der Norm.
 * - Darin läuft ein Balken voll (lock). Bis dahin reagiert der Tooltip nicht auf die Maus und schließt,
 *   sobald sie den Verweis verlässt. Danach ist er festgesetzt: Die Maus kann hinein und dort weitere
 *   Verweise hovern.
 * - Die Tooltips bilden einen Stapel. Verlässt die Maus einen festgesetzten Tooltip und geht weder zu
 *   seinem Verweis noch in einen Tooltip darüber, schließen er und alle darüber nach einer Nachfrist (grace).
 * - Klick oder Enter auf einen Verweis öffnet den Tooltip sofort festgesetzt, Escape schließt den obersten.
 */

import { findCitations } from "./citationParser";
import type { Citation } from "./citationParser";
import { formatCitation } from "./citationFormat";
import { AVAILABLE_LAWS, externalUrl, LawStore } from "./lawStore";
import type { Lookup } from "./lawStore";
import { appendText, nonBreaking, renderNorm } from "./renderNorm";

/** Zeiten in Millisekunden. */
export interface TooltipTiming {
  /** Hover bis zum Öffnen. */
  delay: number;
  /** Vom Öffnen bis zum Festsetzen. */
  lock: number;
  /** Nachfrist, bevor ein festgesetzter Tooltip schließt, den die Maus verlassen hat. */
  grace: number;
}

export const DEFAULT_TIMING: TooltipTiming = { delay: 400, lock: 1000, grace: 300 };

interface Tip {
  element: HTMLElement;
  anchor: HTMLElement;
  citation: Citation;
  locked: boolean;
  lockTimer?: ReturnType<typeof setTimeout>;
}

export class Tooltips {
  private readonly store: LawStore;
  private readonly timing: TooltipTiming;
  private readonly doc: Document;
  /** Verweise, die diese Instanz angelegt hat, mit ihrem Zitat. */
  private readonly refs = new WeakMap<Element, Citation>();
  /** Offene Tooltips; `stack[i]` ist der Tooltip auf Ebene i + 1 (Ebene 0 ist der Seitenbereich). */
  private readonly stack: Tip[] = [];
  private pending?: { anchor: HTMLElement; timer: ReturnType<typeof setTimeout> };
  private graceTimer?: ReturnType<typeof setTimeout>;
  /** Bis zu welcher Ebene die Maus die Tooltips "hält": ihre Ebene, auf dem Verweis eines Tooltips dessen Ebene. */
  private pointerLevel = 0;
  private readonly listeners: [string, EventListener, boolean][];

  constructor(store: LawStore, timing: Partial<TooltipTiming> = {}, doc: Document = document) {
    this.store = store;
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.doc = doc;
    this.listeners = [
      ["pointerover", (e) => this.onPointerOver(e as PointerEvent), false],
      ["pointerout", (e) => this.onPointerOut(e as PointerEvent), false],
      ["click", (e) => this.onClick(e as MouseEvent), false],
      ["keydown", (e) => this.onKeyDown(e as KeyboardEvent), false],
      // Scrollen verschiebt die Verweise unter den Tooltips; Scroll-Ereignisse steigen nicht auf, daher capture.
      ["scroll", (e) => this.closeFrom(this.levelOf(e.target)), true],
    ];
    for (const [type, listener, capture] of this.listeners)
      doc.addEventListener(type, listener, capture);
    doc.defaultView?.addEventListener("resize", this.closeAll);
  }

  /** Entfernt alle Tooltips und Ereignis-Handler. */
  destroy(): void {
    this.closeAll();
    for (const [type, listener, capture] of this.listeners)
      this.doc.removeEventListener(type, listener, capture);
    this.doc.defaultView?.removeEventListener("resize", this.closeAll);
  }

  /** Anzahl offener Tooltips (für Tests und Fehlersuche). */
  get depth(): number {
    return this.stack.length;
  }

  /**
   * `renderText` für renderNorm: schreibt Text und macht die Verweise darin hoverbar.
   * Verweise ohne Gesetzesangabe gehören zu `law`, dem Gesetz der angezeigten Norm.
   */
  linker(law: string): (text: string, into: HTMLElement) => void {
    return (text, into) => {
      // nonBreaking ersetzt nur Leerzeichen, die Positionen der Zitate bleiben gültig.
      const shown = nonBreaking(text);
      const citations = findCitations(text, { defaultLaw: law });
      let pos = 0;
      for (const citation of citations) {
        // "nach dessen § 2": Gesetz unklar, kein Verweis.
        if (!citation.law && !citation.lawText) continue;
        if (citation.start < pos) continue;
        const end = citation.end + lawLength(text.slice(citation.end), citation.lawText);
        appendText(shown.slice(pos, citation.start), into);
        const ref = this.doc.createElement("span");
        ref.className = this.isAvailable(citation) ? "ref" : "ref ref-external";
        ref.setAttribute("role", "button");
        // Ausgeschrieben, weil der Verweistext allein oft nur eine Zahl ist ("281" in "§§ 280, 281").
        ref.setAttribute("aria-label", formatCitation(citation));
        ref.setAttribute("aria-haspopup", "dialog");
        ref.setAttribute("aria-expanded", "false");
        ref.tabIndex = 0;
        appendText(shown.slice(citation.start, end), ref);
        this.refs.set(ref, citation);
        into.append(ref);
        pos = end;
      }
      appendText(shown.slice(pos), into);
    };
  }

  /** Schließt alle Tooltips, z. B. wenn der Seitenbereich eine andere Norm zeigt. */
  readonly closeAll = (): void => {
    this.cancelPending();
    this.closeFrom(0);
  };

  // ------------------------------------------------------------------------------- Ereignisse

  private onPointerOver(event: PointerEvent): void {
    // Auf Touchgeräten gibt es kein Hover; dort öffnet ein Tipp (click) den Tooltip festgesetzt.
    if (event.pointerType === "touch") return;
    this.track(event.target instanceof Element ? event.target : null);
  }

  private onPointerOut(event: PointerEvent): void {
    // Ohne relatedTarget hat die Maus den Seitenbereich verlassen.
    if (event.pointerType !== "touch" && !event.relatedTarget) this.track(null);
  }

  /** Reagiert darauf, dass die Maus jetzt über `target` steht. */
  private track(target: Element | null): void {
    const level = this.levelOf(target);
    const ref = target ? this.refAt(target) : undefined;
    const onAnchor = ref !== undefined && this.stack[level]?.anchor === ref;
    this.pointerLevel = onAnchor ? level + 1 : level;

    if (!ref || onAnchor) this.cancelPending();
    else if (this.pending?.anchor !== ref) this.schedule(ref, level);

    // Nicht festgesetzt: sofort schließen; festgesetzt: nach der Nachfrist.
    const top = this.stack[this.stack.length - 1];
    if (top && !top.locked && this.stack.length > this.pointerLevel)
      this.closeFrom(this.stack.length - 1);
    if (this.stack.length > this.pointerLevel) {
      this.graceTimer ??= setTimeout(() => {
        this.graceTimer = undefined;
        this.closeFrom(this.pointerLevel);
      }, this.timing.grace);
    } else {
      this.clearGrace();
    }
  }

  private onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const level = this.levelOf(target);
    const ref = target ? this.refAt(target) : undefined;
    if (ref) this.activate(ref, level);
    // Klick daneben schließt die Tooltips über der angeklickten Ebene.
    else this.closeFrom(level);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      const hadFocus = top.element.contains(this.doc.activeElement);
      this.closeFrom(this.stack.length - 1);
      if (hadFocus) top.anchor.focus();
      event.preventDefault();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const ref = target ? this.refAt(target) : undefined;
    if (ref && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.activate(ref, this.levelOf(ref)).element.focus();
    }
  }

  // ------------------------------------------------------------------------------- Stapel

  /** Öffnet den Tooltip zu `ref` sofort festgesetzt oder setzt den schon offenen fest. */
  private activate(ref: HTMLElement, level: number): Tip {
    const open = this.stack[level];
    if (open?.anchor === ref) {
      this.lock(open);
      return open;
    }
    return this.open(ref, level, true);
  }

  private schedule(anchor: HTMLElement, level: number): void {
    this.cancelPending();
    const timer = setTimeout(() => {
      this.pending = undefined;
      this.open(anchor, level, false);
    }, this.timing.delay);
    this.pending = { anchor, timer };
  }

  private cancelPending(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  /** Öffnet den Tooltip zu `anchor` auf Ebene `level` + 1; Tooltips ab dieser Ebene schließen vorher. */
  private open(anchor: HTMLElement, level: number, locked: boolean): Tip {
    this.cancelPending();
    this.closeFrom(level);
    const citation = this.refs.get(anchor)!;
    const element = this.el("div", "tooltip");
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", formatCitation(citation));
    element.tabIndex = -1;
    element.dataset.level = String(level + 1);
    element.style.setProperty("--lock-ms", `${this.timing.lock}ms`);
    element.style.zIndex = String(1000 + level);
    const bar = this.el("div", "tooltip-lock");
    bar.append(this.el("span"));
    const body = this.el("div", "tooltip-body");
    body.append(this.el("p", "tooltip-message", "Lädt …"));
    element.append(bar, body);
    this.doc.body.append(element);

    const tip: Tip = { element, anchor, citation, locked: false };
    this.stack.push(tip);
    anchor.classList.add("ref-open");
    anchor.setAttribute("aria-expanded", "true");
    this.place(tip);
    if (locked) this.lock(tip);
    else tip.lockTimer = setTimeout(() => this.lock(tip), this.timing.lock);
    void this.fill(tip, body);
    return tip;
  }

  private lock(tip: Tip): void {
    clearTimeout(tip.lockTimer);
    tip.locked = true;
    tip.element.classList.add("locked");
  }

  /** Schließt `stack[index]` und alle Tooltips darüber. */
  private closeFrom(index: number): void {
    while (this.stack.length > index) {
      const tip = this.stack.pop()!;
      clearTimeout(tip.lockTimer);
      tip.element.remove();
      tip.anchor.classList.remove("ref-open");
      tip.anchor.setAttribute("aria-expanded", "false");
    }
    if (this.pending && !this.pending.anchor.isConnected) this.cancelPending();
    if (this.stack.length <= this.pointerLevel) this.clearGrace();
  }

  /** Ebene, auf der `target` liegt: 0 im Seitenbereich, n im n-ten Tooltip. */
  private levelOf(target: EventTarget | null): number {
    const tooltip = target instanceof Element ? target.closest(".tooltip") : null;
    return this.stack.findIndex((t) => t.element === tooltip) + 1;
  }

  private refAt(target: Element): HTMLElement | undefined {
    const ref = target.closest<HTMLElement>(".ref");
    return ref && this.refs.has(ref) ? ref : undefined;
  }

  // ------------------------------------------------------------------------------- Inhalt

  private isAvailable(citation: Citation): boolean {
    return this.store.isAvailable(citation.law) && citation.unit === "§" && !citation.article;
  }

  private async fill(tip: Tip, body: HTMLElement): Promise<void> {
    let content: Node[];
    try {
      content = this.content(tip, await this.store.lookup(tip.citation));
    } catch (error) {
      content = [
        this.el(
          "p",
          "tooltip-message",
          `Das Gesetz konnte nicht geladen werden: ${(error as Error).message}`
        ),
      ];
    }
    if (!this.stack.includes(tip)) return;
    body.replaceChildren(...content);
    this.place(tip);
  }

  private content(tip: Tip, lookup: Lookup): Node[] {
    const { citation } = tip;
    const unit = citation.unit === "Art" ? "Art." : "§";
    switch (lookup.kind) {
      case "norm": {
        const nodes: Node[] = [];
        if (citation.following)
          nodes.push(
            this.note(
              citation.following === "f"
                ? "„f.“: Die folgende Norm ist mitgemeint."
                : "„ff.“: Die folgenden Normen sind mitgemeint."
            )
          );
        if (citation.rangeTo && !lookup.norm.range)
          nodes.push(this.note(`Bereich bis ${unit} ${citation.rangeTo}; hier der Anfang.`));
        const article = renderNorm(lookup.law.file, lookup.norm, {
          citation,
          compact: true,
          renderText: this.linker(lookup.law.file.abbr),
        });
        this.collapse(article, tip);
        nodes.push(article);
        return nodes;
      }
      case "missing":
        return [
          this.heading(citation),
          this.el(
            "p",
            "tooltip-message",
            `${unit} ${citation.section} gibt es im ${lookup.law.file.abbr} nicht.`
          ),
        ];
      case "unavailable":
      case "no-law": {
        const law = citation.law;
        const nodes: Node[] = [this.heading(citation)];
        const available = Object.keys(AVAILABLE_LAWS).join(" und ");
        const name = law ?? (citation.lawText ? `„${citation.lawText}“` : "Das Gesetz");
        const text = this.store.isAvailable(law)
          ? `Artikel gibt es im ${law} nicht.`
          : `${name} ist nicht enthalten. Das Add-in bringt den Text von ${available} mit.`;
        nodes.push(this.el("p", "tooltip-message", text));
        const url = law ? externalUrl(law, citation) : undefined;
        if (url) {
          const link = this.el("a", undefined, "Auf gesetze-im-internet.de öffnen");
          link.setAttribute("href", url);
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener");
          const p = this.el("p", "tooltip-message");
          p.append(link);
          nodes.push(p);
        }
        return nodes;
      }
    }
  }

  /** Bei zitierten Absätzen nur diese zeigen; ein Knopf klappt die übrigen auf. */
  private collapse(article: HTMLElement, tip: Tip): void {
    const paragraphs = [...article.querySelectorAll<HTMLElement>(".norm-text > .absatz")];
    const hidden = paragraphs.filter((p) => !p.matches(".cited, .cited-context"));
    if (hidden.length === 0 || hidden.length === paragraphs.length) return;
    for (const p of hidden) p.hidden = true;
    const more = this.el(
      "button",
      "tooltip-more",
      `Ganze Norm anzeigen (+${hidden.length} ${hidden.length === 1 ? "Absatz" : "Absätze"})`
    );
    more.type = "button";
    more.addEventListener("click", () => {
      for (const p of hidden) p.hidden = false;
      // Nur verstecken, nicht entfernen: Der Klick soll danach noch als Klick in diesen Tooltip zählen.
      more.hidden = true;
      this.closeFrom(this.stack.indexOf(tip) + 1);
      this.place(tip);
    });
    article.querySelector(".norm-text")!.after(more);
  }

  private heading(citation: Citation): HTMLElement {
    const header = this.el("header", "norm-header");
    header.append(this.el("h2", "norm-heading", nonBreaking(formatCitation(citation))));
    return header;
  }

  private note(text: string): HTMLElement {
    return this.el("p", "tooltip-note", nonBreaking(text));
  }

  // ------------------------------------------------------------------------------- Position

  private place(tip: Tip): void {
    const view = {
      width: this.doc.documentElement.clientWidth,
      height: this.doc.documentElement.clientHeight,
    };
    const style = tip.element.style;
    style.removeProperty("--room");
    const { width, height } = tip.element.getBoundingClientRect();
    const spot = placeTooltip(tip.anchor.getBoundingClientRect(), width, height, view);
    style.left = `${spot.left}px`;
    style.top = `${spot.top}px`;
    style.setProperty("--room", `${spot.room}px`);
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
  ): HTMLElementTagNameMap[K] {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
}

/**
 * Länge des Gesetzes, wenn es direkt hinter der Norm steht: In "§ 377 HGB und § 263 StGB" gehört
 * "HGB" zum Verweis, in "§§ 823, 826 BGB" das "BGB" nur zu "826".
 */
function lawLength(after: string, lawText: string | undefined): number {
  if (!lawText) return 0;
  const space = /^[\s\u00a0]*/.exec(after)![0].length;
  return after.startsWith(lawText, space) ? space + lawText.length : 0;
}

interface Box {
  left: number;
  top: number;
  bottom: number;
}

/**
 * Position eines Tooltips der Größe `width` × `height` an einem Verweis: möglichst darunter, sonst
 * darüber, wo mehr Platz ist; waagerecht am Verweis ausgerichtet, aber ganz im Fenster.
 * `room` ist die Höhe, die dort höchstens Platz hat (der Tooltip scrollt dann).
 */
export function placeTooltip(
  anchor: Box,
  width: number,
  height: number,
  view: { width: number; height: number },
  margin = 8,
  gap = 4
): { left: number; top: number; room: number } {
  const left = Math.max(margin, Math.min(anchor.left, view.width - margin - width));
  const below = view.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const useBelow = height <= below || below >= above;
  const room = Math.max(0, useBelow ? below : above);
  const top = useBelow ? anchor.bottom + gap : anchor.top - gap - Math.min(height, room);
  return { left, top, room };
}
