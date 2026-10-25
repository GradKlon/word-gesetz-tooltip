// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { LawStore } from "../lawStore";
import type { LawFile } from "../lawTypes";
import { loadLawFromDisk } from "../testData";
import { paragraphAt } from "./demo";
import { CitationPanel } from "./panel";

let root: HTMLElement;
let panel: CitationPanel;
beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("section");
  document.body.append(root);
  panel = new CitationPanel(root, new LawStore(loadLawFromDisk));
});

/** Text ohne geschützte Leerzeichen, damit die Erwartungen lesbar bleiben. */
const plain = (text: string | null | undefined) => text?.replace(/\u00a0/g, " ");
const status = () => plain(root.querySelector(".panel-status")?.textContent);
const heading = () => plain(root.querySelector(".norm-heading")?.textContent);
const notes = () => [...root.querySelectorAll(".panel-note")].map((n) => plain(n.textContent));
const message = () => plain(root.querySelector(".panel-message")?.textContent);
const link = () => root.querySelector(".panel-message a")?.getAttribute("href");
const switches = () => [...root.querySelectorAll<HTMLButtonElement>(".panel-switch")];
/** Cursor auf das `nth`-te Vorkommen von `needle` (plus `delta` Zeichen) in `text`. */
const at = (text: string, needle: string, delta = 1, nth = 0) => {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = text.indexOf(needle, i + 1);
  return panel.showCursor({ text, offset: i + delta });
};
const usingLoader = (load: (slug: string) => Promise<LawFile>) => {
  panel = new CitationPanel(root, new LawStore(load));
};

describe("CitationPanel", () => {
  it("startet mit einer Anleitung", () => {
    expect(status()).toBe("Kein Zitat ausgewählt");
    expect(root.querySelector(".panel-intro")?.textContent).toContain("Setze den Cursor");
  });

  it("zeigt die Norm unter dem Cursor mit hervorgehobenem Absatz", async () => {
    await at("Anspruch aus §§ 280 Abs. 1, 241 Abs. 2 BGB.", "241");
    expect(status()).toBe("§ 241 Abs. 2 BGB");
    expect(heading()).toBe("§ 241 BGB");
    expect(root.querySelector(".absatz.cited")?.getAttribute("data-absatz")).toBe("2");
  });

  it("macht Verweise im Normtext hoverbar und schließt Tooltips beim Wechsel", async () => {
    await at("§ 280 BGB", "280");
    const refs = [...root.querySelectorAll(".norm-text .ref")].map((r) =>
      r.getAttribute("aria-label")
    );
    expect(refs).toEqual(["§ 286 BGB", "§ 281 BGB", "§ 282 BGB", "§ 283 BGB"]);
    root.querySelector<HTMLElement>(".norm-text .ref")!.click();
    expect(document.querySelectorAll(".tooltip")).toHaveLength(1);
    await at("§ 433 BGB", "433");
    expect(document.querySelectorAll(".tooltip")).toHaveLength(0);
  });

  it("aktualisiert die Hervorhebung bei derselben Norm mit anderer Stelle", async () => {
    const text = "§ 433 Abs. 1 BGB und § 433 Abs. 2 BGB";
    await at(text, "433");
    await at(text, "433", 1, 1);
    expect(root.querySelector(".absatz.cited")?.getAttribute("data-absatz")).toBe("2");
  });

  describe("Gesetz aus dem Zusammenhang", () => {
    it("nimmt das zuletzt im Absatz genannte Gesetz", async () => {
      await at(
        "Nach § 377 Abs. 1 HGB muss K rügen. Sonst gilt die Ware gem. § 377 II als genehmigt.",
        "§ 377 II"
      );
      expect(heading()).toBe("§ 377 HGB");
      expect(notes()).toEqual([
        "Kein Gesetz angegeben – aus dem Zusammenhang: HGB. § 377 BGB anzeigen",
      ]);
    });

    it("auch ein nicht enthaltenes Gesetz (StGB) statt eines älteren BGB-Zitats", async () => {
      await at(
        "Der Anspruch folgt aus § 823 Abs. 2 BGB i.V.m. § 263 StGB. Ein Betrug nach § 263 Abs. 1 setzt eine Täuschung voraus.",
        "§ 263 Abs. 1"
      );
      expect(message()).toContain("StGB ist nicht enthalten");
      expect(link()).toBe("https://www.gesetze-im-internet.de/stgb/__263.html");
      expect(notes()[0]).toBe(
        "Kein Gesetz angegeben – aus dem Zusammenhang: StGB. § 263 BGB anzeigen § 263 HGB anzeigen"
      );
    });

    it("Artikel nehmen das Gesetz nur von Artikeln", async () => {
      await at(
        "… § 823 Abs. 1 BGB und folgt aus Art. 2 Abs. 1 i.V.m. Art. 1 Abs. 1 GG. Art. 2 Abs. 1 schützt …",
        "Art. 2",
        5,
        1
      );
      expect(message()).toContain("GG ist nicht enthalten");
      expect(link()).toBe("https://www.gesetze-im-internet.de/gg/art_2.html");
    });

    it("gibt es die Norm im Kontextgesetz nicht, wird im anderen enthaltenen Gesetz gesucht", async () => {
      await at(
        "K ist Kaufmann (§ 1 Abs. 1 HGB). Der Anspruch folgt aus § 812 Abs. 1 S. 1 Alt. 1.",
        "§ 812"
      );
      expect(heading()).toBe("§ 812 BGB");
      expect(notes()).toEqual(["Kein Gesetz angegeben – angenommen: BGB."]);
    });

    it("bietet das andere Gesetz zum Umschalten an", async () => {
      await at("Nach § 377 HGB … außerdem § 1 Abs. 2.", "§ 1");
      expect(heading()).toBe("§ 1 HGB");
      expect(switches().map((b) => plain(b.textContent))).toEqual(["§ 1 BGB anzeigen"]);
    });
  });

  describe("Gesetz angenommen", () => {
    it("ohne Zusammenhang: BGB, mit Knopf für HGB", async () => {
      await at("Gem. § 1 ist das so.", "§ 1");
      expect(heading()).toBe("§ 1 BGB");
      expect(switches().map((b) => plain(b.textContent))).toEqual(["§ 1 HGB anzeigen"]);
    });

    it("lieber eine geltende HGB-Norm als eine im BGB weggefallene", async () => {
      await at("Die negative Publizität nach § 15 Abs. 1 schützt den Dritten.", "§ 15");
      expect(heading()).toBe("§ 15 HGB");
      expect(switches()).toEqual([]);
    });

    it("gibt es die Norm nirgends, sagt der Seitenbereich das", async () => {
      await at("Gem. § 9999 ist das so.", "§ 9999");
      expect(message()).toBe("Kein Gesetz angegeben, und weder im BGB noch im HGB gibt es § 9999.");
    });

    it("Artikel ohne Gesetz", async () => {
      await at("Siehe Art. 3 Abs. 1.", "Art.");
      expect(message()).toBe("Kein Gesetz angegeben. BGB und HGB haben keine Artikel.");
    });

    it("die Wahl per Knopf bleibt bei Cursorbewegungen im selben Zitat", async () => {
      const text = "Gem. § 1 Abs. 2 ist das so.";
      await at(text, "§ 1");
      switches()[0].click();
      expect(heading()).toBe("§ 1 HGB");
      expect(notes()[0]).toBe("Kein Gesetz angegeben – gewählt: HGB. § 1 BGB anzeigen");
      expect(document.activeElement).toBe(switches()[0]);
      await at(text, "Abs.");
      expect(heading()).toBe("§ 1 HGB");
    });
  });

  describe("Hinweise", () => {
    it("a.F., ff. und Bereiche nur, wenn eine Norm angezeigt wird", async () => {
      await at("§ 476 BGB a.F.", "476");
      expect(notes()).toEqual([
        "Das Zitat nennt eine alte Fassung (a.F.); angezeigt wird die aktuelle.",
      ]);
      await at("§§ 145 ff. BGB", "145");
      expect(notes()).toEqual([
        "Angezeigt wird § 145; die folgenden Normen sind mitgemeint („ff.“).",
      ]);
      await at("§§ 104 bis 113 BGB", "104");
      expect(notes()).toEqual(["Bereich bis § 113: angezeigt wird der Anfang, § 104."]);
      await at("§§ 3 bis 6 BGB", "3");
      expect(notes()).toEqual([]);
      expect(heading()).toBe("§§ 3 bis 6 BGB");
      await at("§§ 32 ff. StGB", "32");
      expect(notes()).toEqual([]);
    });
  });

  describe("nicht enthaltene Gesetze", () => {
    it("verlinkt auf gesetze-im-internet.de, auch bei abweichendem Seitennamen", async () => {
      await at("§ 263 StGB", "263");
      expect(link()).toBe("https://www.gesetze-im-internet.de/stgb/__263.html");
      await at("§ 3 UWG", "3");
      expect(link()).toBe("https://www.gesetze-im-internet.de/uwg_2004/__3.html");
      await at("Art. 2 Abs. 1 GG", "2");
      expect(link()).toBe("https://www.gesetze-im-internet.de/gg/art_2.html");
    });

    it("kein Link für EU-Recht und EGBGB-Artikel", async () => {
      await at("Art. 6 Abs. 1 lit. f DSGVO", "6");
      expect(message()).toContain("DSGVO ist nicht enthalten");
      expect(link()).toBeUndefined();
      await at("Art. 229 § 5 EGBGB", "229");
      expect(message()).toContain("Artikel 229 § 5 ist nicht enthalten");
      expect(link()).toBeUndefined();
    });
  });

  it("nicht vorhandene Norm", async () => {
    await at("§ 9999 BGB", "9999");
    expect(message()).toBe("§ 9999 gibt es im BGB nicht.");
  });

  describe("außerhalb eines Zitats", () => {
    it("bleibt die zuletzt gezeigte Norm stehen", async () => {
      const text = "Anspruch aus § 433 BGB. Weiterer Text.";
      await at(text, "433");
      await at(text, "Weiterer");
      expect(status()).toBe("Zuletzt angezeigt");
      expect(heading()).toBe("§ 433 BGB");
      await panel.showCursor(null);
      expect(heading()).toBe("§ 433 BGB");
    });

    it("zeigt nie ein veraltetes Zitat im Status", async () => {
      await at("Weiterer Text.", "Weiterer");
      expect(status()).toBe("Kein Zitat am Cursor");
      const text = "Nach § 9999 BGB gilt das. Weiterer Text.";
      await at(text, "9999");
      await at(text, "Weiterer");
      expect(status()).toBe("Zuletzt angezeigt");
    });
  });

  describe("Laden und Reihenfolge", () => {
    it("ein langsames älteres Laden überschreibt kein neueres Ergebnis", async () => {
      let releaseBgb!: () => void;
      const slowBgb = new Promise<void>((resolve) => (releaseBgb = resolve));
      usingLoader(async (slug) => {
        if (slug === "bgb") await slowBgb;
        return loadLawFromDisk(slug);
      });
      const first = at("§ 433 BGB", "433");
      await at("§ 377 HGB", "377");
      releaseBgb();
      await first;
      expect(heading()).toBe("§ 377 HGB");
      expect(status()).toBe("§ 377 HGB");
    });

    it("Ladefehler wird angezeigt, danach klappt es wieder", async () => {
      let fail = true;
      usingLoader(async (slug) => {
        if (fail) throw new Error("HTTP 404");
        return loadLawFromDisk(slug);
      });
      await at("§ 433 BGB", "433");
      expect(message()).toBe("Das Gesetz konnte nicht geladen werden: HTTP 404");
      fail = false;
      await at("§ 433 BGB", "433");
      expect(heading()).toBe("§ 433 BGB");
    });

    it("beim Annehmen wird ein Ladefehler nicht als anderes Gesetz ausgegeben", async () => {
      usingLoader(async (slug) => {
        if (slug === "bgb") throw new Error("HTTP 503");
        return loadLawFromDisk(slug);
      });
      // § 433 gibt es nur im BGB als Kaufvertrag; im HGB ist es eine andere Norm, die dann angezeigt wird.
      await at("Der Käufer ist nach § 433 Abs. 2 zur Zahlung verpflichtet.", "§ 433");
      expect(heading()).toBe("§ 433 HGB");
      usingLoader(() => Promise.reject(new Error("HTTP 503")));
      await at("Der Käufer ist nach § 433 Abs. 2 zur Zahlung verpflichtet.", "§ 433");
      expect(message()).toBe("Das Gesetz konnte nicht geladen werden: HTTP 503");
    });
  });

  it("Probleme von Word werden angezeigt", () => {
    panel.showProblem("Das Word-Dokument konnte nicht gelesen werden: AccessDenied");
    expect(message()).toBe("Das Word-Dokument konnte nicht gelesen werden: AccessDenied");
  });
});

describe("paragraphAt (Demo)", () => {
  it("liefert die Zeile unter dem Cursor und die Position darin", () => {
    const text = "Erste Zeile\nZweite § 433 BGB\nDritte";
    expect(paragraphAt(text, text.indexOf("433"))).toEqual({ text: "Zweite § 433 BGB", offset: 9 });
    expect(paragraphAt(text, 0)).toEqual({ text: "Erste Zeile", offset: 0 });
    expect(paragraphAt(text, text.length)).toEqual({ text: "Dritte", offset: 6 });
  });
});
