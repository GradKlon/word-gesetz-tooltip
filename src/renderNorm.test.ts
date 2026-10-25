// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { findCitations } from "./citationParser";
import { LawStore } from "./lawStore";
import type { LoadedLaw } from "./lawStore";
import { renderNorm } from "./renderNorm";
import { loadLawFromDisk } from "./testData";

let bgb: LoadedLaw;
let hgb: LoadedLaw;
beforeAll(async () => {
  const store = new LawStore(loadLawFromDisk);
  [bgb, hgb] = await Promise.all([store.law("BGB"), store.law("HGB")]);
});

function render(law: () => LoadedLaw, id: string, citation?: string): HTMLElement {
  return renderNorm(law().file, law().byId.get(id)!, {
    citation: citation ? findCitations(citation)[0] : undefined,
  });
}
/** Innerste zitierte Stellen (voll hervorgehoben) und umgebende (nur Rand). */
const cited = (article: HTMLElement, selector = ".cited") =>
  [...article.querySelectorAll<HTMLElement>(selector)].map(
    (e) => e.dataset.absatz ?? e.dataset.label
  );
const context = (article: HTMLElement) => cited(article, ".cited-context");

describe("renderNorm", () => {
  it("Überschrift, Gliederung, Absätze und Quelle", () => {
    const article = render(() => bgb, "433");
    expect(article.querySelector(".norm-heading")?.textContent).toBe("§ 433 BGB");
    expect(article.querySelector(".norm-title")?.textContent).toBe(
      "Vertragstypische Pflichten beim Kaufvertrag"
    );
    expect(article.querySelector(".norm-path-bez")?.textContent).toBe(
      "Buch\u00a02 › Abschnitt\u00a08 › Titel\u00a01 › Untertitel\u00a01"
    );
    expect(article.querySelectorAll(".absatz")).toHaveLength(2);
    expect(article.querySelector(".norm-source a")?.getAttribute("href")).toBe(
      "https://www.gesetze-im-internet.de/bgb/__433.html"
    );
  });

  it("hebt zitierte Absätze hervor", () => {
    expect(cited(render(() => bgb, "433", "§ 433 Abs. 2 BGB"))).toEqual(["2"]);
    expect(cited(render(() => bgb, "280", "§ 280 I, III BGB"))).toEqual(["1", "3"]);
    expect(cited(render(() => bgb, "433", "§ 433 BGB"))).toEqual([]);
  });

  it("hebt die innerste Stelle voll hervor, umgebende Absätze und Nummern nur am Rand", () => {
    expect(cited(render(() => bgb, "437", "§ 437 Nr. 2 BGB"))).toEqual(["2."]);
    const p312 = render(() => bgb, "312", "§ 312 Abs. 2 Nr. 3 BGB");
    expect(cited(p312)).toEqual(["3."]);
    expect(context(p312)).toEqual(["2"]);
    const p81 = render(() => bgb, "81", "§ 81 Abs. 1 Nr. 1 Buchst. b BGB");
    expect(cited(p81)).toEqual(["b)"]);
    expect(context(p81)).toEqual(["1", "1."]);
  });

  it("Buchstaben auf der ersten Listenebene (§ 1760 Abs. 2 BGB)", () => {
    const article = render(() => bgb, "1760", "§ 1760 Abs. 2 Buchstabe b BGB");
    expect(cited(article)).toEqual(["b)"]);
    expect(context(article)).toEqual(["2"]);
  });

  it("zitierte Stellen sind für Screenreader benannt", () => {
    const article = render(() => bgb, "433", "§ 433 Abs. 2 BGB");
    expect(article.querySelector(".cited .visually-hidden")?.textContent).toBe("Zitiert: ");
  });

  it("kein Zeilenumbruch zwischen § und Zahl", () => {
    const text = render(() => bgb, "437").querySelector(".listenpunkt-text")?.textContent;
    expect(text).toContain("nach §\u00a0439");
  });

  it("zweizeilige Überschriften und Listen mit mehreren Zeilen", () => {
    const article = render(() => hgb, "257");
    expect(article.querySelector(".norm-title")?.innerHTML).toBe(
      "Aufbewahrung von Unterlagen<br>Aufbewahrungsfristen"
    );
    const item = render(() => bgb, "308").querySelector(".listenpunkt-text");
    expect(item?.innerHTML).toContain("(Annahme- und Leistungsfrist)<br>");
  });

  it("weggefallene Normen und Bereiche", () => {
    const range = render(() => bgb, "4");
    expect(range.querySelector(".norm-heading")?.textContent).toBe("§§ 3 bis 6 BGB");
    expect(range.querySelector(".norm-repealed")?.textContent).toBe("§§ 3 bis 6 sind weggefallen.");
    const moved = render(() => bgb, "651");
    expect(moved.querySelector(".norm-title")?.textContent).toBe("(jetzt §\u00a0650)");
    expect(moved.querySelector(".norm-text")).toBeNull();
  });

  it("amtliche Fußnoten", () => {
    expect(render(() => bgb, "14").querySelector(".norm-footnotes")?.textContent).toContain(
      "Amtlicher Hinweis:"
    );
  });

  it("Text aus den Daten wird nie als HTML ausgewertet", () => {
    const law = { ...bgb.file, abbr: "<b>X</b>" };
    const norm = {
      id: "1",
      label: "§ 1",
      title: "<img src=x onerror=alert(1)>",
      paragraphs: [{ content: ["<script>"] }],
    };
    const article = renderNorm(law, norm);
    expect(article.querySelector("img, script, b")).toBeNull();
    expect(article.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
