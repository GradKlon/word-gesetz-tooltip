// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawStore } from "./lawStore";
import { loadLawFromDisk } from "./testData";
import { placeTooltip, Tooltips } from "./tooltip";

let tooltips: Tooltips;
let page: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  page = document.createElement("div");
  document.body.append(page);
  tooltips = new Tooltips(new LawStore(loadLawFromDisk));
});

afterEach(() => {
  tooltips.destroy();
  vi.useRealTimers();
});

/** Text ohne geschützte Leerzeichen, damit die Erwartungen lesbar bleiben. */
const plain = (text: string | null | undefined) => text?.replace(/\u00a0/g, " ");
/** Schreibt `text` als Normtext des Gesetzes `law` in die Seite und gibt die Verweise zurück. */
const write = (text: string, law = "BGB") => {
  tooltips.linker(law)(text, page);
  return [...page.querySelectorAll<HTMLElement>(".ref")];
};
const refTexts = (refs: HTMLElement[]) => refs.map((r) => plain(r.textContent));
const tips = () => [...document.querySelectorAll<HTMLElement>(".tooltip")];
const heading = (tip: HTMLElement) => plain(tip.querySelector(".norm-heading")?.textContent);
/** Die Maus steht jetzt über `target` (null: hat den Seitenbereich verlassen). */
const hover = (target: Element | null) => {
  if (target)
    target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  else
    document.body.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })
    );
};
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/** Verweis im Tooltip `tip`, dessen Text mit `start` beginnt. */
const refIn = (tip: HTMLElement, start: string) =>
  [...tip.querySelectorAll<HTMLElement>(".ref")].find((r) =>
    plain(r.textContent)?.startsWith(start)
  )!;

describe("Verweise im Normtext", () => {
  it("macht Zitate hoverbar und behält den Text", () => {
    const text = "nach den §§ 280 Abs. 1, 281. Ferner § 377 HGB und § 263 StGB.";
    const refs = write(text);
    expect(refTexts(refs)).toEqual(["§§ 280 Abs. 1", "281", "§ 377 HGB", "§ 263 StGB"]);
    expect(refs.map((r) => r.getAttribute("aria-label"))).toEqual([
      "§ 280 Abs. 1 BGB",
      "§ 281 BGB",
      "§ 377 HGB",
      "§ 263 StGB",
    ]);
    expect(plain(page.textContent)).toBe(text);
    expect(refs.map((r) => r.classList.contains("ref-external"))).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("verknüpft Verweise ohne Gesetz mit dem Gesetz der Norm", async () => {
    const [ref] = write("Die §§ 343 bis 345 gelten.", "HGB");
    hover(ref);
    await wait(400);
    expect(heading(tips()[0])).toBe("§ 343 HGB");
  });

  it("lässt Verweise mit unklarem Gesetz als Text stehen", () => {
    expect(write("nach dessen § 2")).toEqual([]);
  });

  it("behält Zeilenumbrüche und geschützte Leerzeichen", () => {
    write("Satz eins\nnach § 1 Abs. 2");
    expect(page.querySelectorAll("br")).toHaveLength(1);
    expect(page.querySelector(".ref")?.textContent).toBe("§\u00a01 Abs.\u00a02");
  });
});

describe("Öffnen und Festsetzen", () => {
  it("öffnet nach der Verzögerung und setzt sich nach dem Balken fest", async () => {
    const [ref] = write("gem. § 433 Abs. 1 BGB");
    hover(ref);
    await wait(399);
    expect(tips()).toHaveLength(0);
    await wait(1);
    expect(tips()).toHaveLength(1);
    expect(heading(tips()[0])).toBe("§ 433 BGB");
    expect(tips()[0].classList.contains("locked")).toBe(false);
    await wait(1000);
    expect(tips()[0].classList.contains("locked")).toBe(true);
  });

  it("öffnet nicht, wenn die Maus vorher weiterzieht", async () => {
    const [ref] = write("gem. § 433 BGB");
    hover(ref);
    await wait(300);
    hover(page);
    await wait(500);
    expect(tips()).toHaveLength(0);
  });

  it("schließt vor dem Festsetzen sofort, wenn die Maus den Verweis verlässt", async () => {
    const [ref] = write("gem. § 433 BGB");
    hover(ref);
    await wait(600);
    hover(page);
    expect(tips()).toHaveLength(0);
  });

  it("Klick öffnet sofort festgesetzt", async () => {
    const [ref] = write("gem. § 433 BGB");
    ref.click();
    await wait(0);
    expect(tips()).toHaveLength(1);
    expect(tips()[0].classList.contains("locked")).toBe(true);
  });

  it("ein anderer Verweis ersetzt den offenen Tooltip", async () => {
    const [a, b] = write("§ 433 BGB und § 377 HGB");
    hover(a);
    await wait(1400);
    hover(b);
    await wait(400);
    expect(tips().map(heading)).toEqual(["§ 377 HGB"]);
  });
});

describe("Stapel", () => {
  /** Öffnet § 280 BGB und setzt ihn fest; die Maus steht danach im Tooltip. */
  const openLocked = async () => {
    const [ref] = write("aus § 280 Abs. 1 BGB");
    hover(ref);
    await wait(1400);
    const tip = tips()[0];
    hover(tip.querySelector(".norm-text")!);
    return { ref, tip };
  };

  it("öffnet verschachtelte Tooltips aus einem festgesetzten", async () => {
    const { tip } = await openLocked();
    // § 280 Abs. 1 ist zitiert; Abs. 3 mit den Verweisen auf §§ 281 ff. erst aufklappen.
    tip.querySelector<HTMLButtonElement>(".tooltip-more")!.click();
    hover(refIn(tip, "§ 281"));
    await wait(400);
    expect(tips().map(heading)).toEqual(["§ 280 BGB", "§ 281 BGB"]);
    expect(tooltips.depth).toBe(2);
  });

  it("Maus zurück in den unteren Tooltip schließt nur die darüber", async () => {
    const { tip } = await openLocked();
    tip.querySelector<HTMLButtonElement>(".tooltip-more")!.click();
    hover(refIn(tip, "§ 281"));
    await wait(1400);
    hover(tips()[1].querySelector(".norm-text")!);
    hover(tip.querySelector(".norm-heading")!);
    await wait(299);
    expect(tips()).toHaveLength(2);
    await wait(1);
    expect(tips().map(heading)).toEqual(["§ 280 BGB"]);
  });

  it("Maus aus allen Tooltips schließt den Stapel nach der Nachfrist", async () => {
    await openLocked();
    hover(page);
    await wait(299);
    expect(tips()).toHaveLength(1);
    await wait(1);
    expect(tips()).toHaveLength(0);
  });

  it("Rückkehr zum Verweis hält den Tooltip offen", async () => {
    const { ref } = await openLocked();
    hover(page);
    await wait(100);
    hover(ref);
    await wait(1000);
    expect(tips()).toHaveLength(1);
  });

  it("Maus verlässt den Seitenbereich: alles schließt", async () => {
    await openLocked();
    hover(null);
    await wait(300);
    expect(tips()).toHaveLength(0);
  });

  it("Escape schließt den obersten Tooltip", async () => {
    await openLocked();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tips()).toHaveLength(0);
  });

  it("Enter auf einem Verweis öffnet festgesetzt und setzt den Fokus hinein", async () => {
    const [ref] = write("§ 433 BGB");
    ref.focus();
    ref.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(0);
    expect(tips()[0].classList.contains("locked")).toBe(true);
    expect(document.activeElement).toBe(tips()[0]);
  });

  it("closeAll schließt alles", async () => {
    await openLocked();
    tooltips.closeAll();
    expect(tips()).toHaveLength(0);
    expect(page.querySelector(".ref-open")).toBeNull();
  });
});

describe("Inhalt", () => {
  const open = async (text: string, law = "BGB") => {
    const [ref] = write(text, law);
    ref.click();
    await wait(0);
    return tips()[0];
  };
  const visible = (tip: HTMLElement) =>
    [...tip.querySelectorAll<HTMLElement>(".absatz")]
      .filter((a) => !a.hidden)
      .map((a) => a.dataset.absatz);

  it("zeigt nur den zitierten Absatz, der Rest lässt sich aufklappen", async () => {
    const tip = await open("§ 280 Abs. 1 BGB");
    expect(visible(tip)).toEqual(["1"]);
    const more = tip.querySelector<HTMLButtonElement>(".tooltip-more")!;
    expect(more.textContent).toBe("Ganze Norm anzeigen (+2 Absätze)");
    more.click();
    expect(visible(tip)).toEqual(["1", "2", "3"]);
    expect(more.hidden).toBe(true);
    expect(tips()).toHaveLength(1);
  });

  it("ganze Norm, wenn kein Absatz zitiert ist", async () => {
    const tip = await open("§ 280 BGB");
    expect(visible(tip)).toEqual(["1", "2", "3"]);
    expect(tip.querySelector(".tooltip-more")).toBeNull();
  });

  it("kompakt: ohne Gliederung und Quellenzeile", async () => {
    const tip = await open("§ 433 BGB");
    expect(tip.querySelector(".norm-path")).toBeNull();
    expect(tip.querySelector(".norm-source")).toBeNull();
  });

  it("Hinweis für nicht enthaltene Gesetze mit Link", async () => {
    const tip = await open("§ 263 StGB");
    expect(heading(tip)).toBe("§ 263 StGB");
    expect(tip.textContent).toContain("StGB ist nicht enthalten");
    expect(tip.querySelector("a")?.getAttribute("href")).toBe(
      "https://www.gesetze-im-internet.de/stgb/__263.html"
    );
  });

  it("Hinweis für Normen, die es nicht gibt", async () => {
    const tip = await open("§ 9999 HGB");
    expect(plain(tip.textContent)).toContain("§ 9999 gibt es im HGB nicht.");
  });

  it("Hinweis bei „ff.“", async () => {
    const tip = await open("§§ 145 ff. BGB");
    expect(tip.querySelector(".tooltip-note")?.textContent).toContain("folgenden Normen");
  });

  it("Ladefehler erscheinen im Tooltip", async () => {
    tooltips.destroy();
    tooltips = new Tooltips(new LawStore(() => Promise.reject(new Error("offline"))));
    const tip = await open("§ 433 BGB");
    expect(tip.textContent).toBe("Das Gesetz konnte nicht geladen werden: offline");
  });
});

describe("placeTooltip", () => {
  const view = { width: 320, height: 600 };

  it("unter dem Verweis, wenn Platz ist", () => {
    expect(placeTooltip({ left: 40, top: 100, bottom: 118 }, 200, 150, view)).toEqual({
      left: 40,
      top: 122,
      room: 470,
    });
  });

  it("über dem Verweis, wenn unten zu wenig Platz ist", () => {
    expect(placeTooltip({ left: 40, top: 500, bottom: 518 }, 200, 150, view)).toEqual({
      left: 40,
      top: 346,
      room: 488,
    });
  });

  it("bleibt in der schmalen Pane", () => {
    expect(placeTooltip({ left: 250, top: 100, bottom: 118 }, 304, 150, view).left).toBe(8);
    expect(placeTooltip({ left: 200, top: 100, bottom: 118 }, 100, 150, view).left).toBe(200);
    expect(placeTooltip({ left: 280, top: 100, bottom: 118 }, 100, 150, view).left).toBe(212);
  });

  it("nimmt die größere Seite und begrenzt die Höhe, wenn nichts passt", () => {
    const spot = placeTooltip({ left: 0, top: 200, bottom: 218 }, 300, 900, view);
    expect(spot).toEqual({ left: 8, top: 222, room: 370 });
  });
});
