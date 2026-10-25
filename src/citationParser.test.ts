import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citationAt, findCitations } from "./citationParser";
import type { Citation, ParseOptions } from "./citationParser";
import type { Inline, LawFile, Norm } from "./lawTypes";

/** Kurzform eines Zitats für Vergleiche: nur die inhaltlich relevanten Felder und die Textstellen. */
function cite(text: string, options?: ParseOptions) {
  return findCitations(text, options).map((c: Citation) => {
    const { start, end, groupStart, groupEnd, ...rest } = c;
    return { ...rest, text: text.slice(start, end), group: text.slice(groupStart, groupEnd) };
  });
}

const sections = (text: string, options?: ParseOptions) =>
  cite(text, options).map((c) => [c.section, c.law]);

describe("Zitate in juristischen Texten", () => {
  it("Absatz und Satz ausgeschrieben oder abgekürzt", () => {
    expect(cite("Anspruch aus § 433 Abs. 1 S. 2 BGB.")).toEqual([
      {
        unit: "§",
        section: "433",
        pinpoints: [{ absatz: "1", satz: "2" }],
        law: "BGB",
        lawText: "BGB",
        text: "§ 433 Abs. 1 S. 2",
        group: "§ 433 Abs. 1 S. 2 BGB",
      },
    ]);
    expect(cite("§ 433 Absatz 1 Satz 1 und 2 BGB")[0].pinpoints).toEqual([
      { absatz: "1", satz: "1" },
      { absatz: "1", satz: "2" },
    ]);
  });

  it("römische Absatzzahlen mit Satz", () => {
    expect(cite("§ 433 I 1 BGB")[0]).toMatchObject({
      section: "433",
      pinpoints: [{ absatz: "1", satz: "1" }],
      law: "BGB",
    });
    expect(cite("§ 280 III BGB")[0].pinpoints).toEqual([{ absatz: "3" }]);
  });

  it("Nummer, Buchstabe, Alternative und Halbsatz", () => {
    expect(cite("§ 312 Abs. 1 Nr. 2 BGB")[0].pinpoints).toEqual([{ absatz: "1", nr: "2" }]);
    expect(cite("§ 81 Abs. 1 Nr. 1 Buchst. a BGB")[0].pinpoints).toEqual([
      { absatz: "1", nr: "1", buchstabe: "a" },
    ]);
    expect(cite("§ 812 I 1 Alt. 1 BGB")[0].pinpoints).toEqual([
      { absatz: "1", satz: "1", alt: "1" },
    ]);
    expect(cite("§ 812 I 1 1. Alt. BGB")[0].pinpoints).toEqual([
      { absatz: "1", satz: "1", alt: "1" },
    ]);
    expect(cite("§ 439 Abs. 3 S. 1 Hs. 2 BGB")[0].pinpoints).toEqual([
      { absatz: "3", satz: "1", halbsatz: "2" },
    ]);
  });

  it("Satz innerhalb einer Nummer", () => {
    expect(cite("§ 569 Abs. 3 Nr. 2 S. 1 BGB")[0].pinpoints).toEqual([
      { absatz: "3", nr: "2", satz: "1" },
    ]);
  });

  it("Buchstabenparagrafen, auch mit Leerzeichen", () => {
    expect(cite("§ 823a BGB")[0]).toMatchObject({ section: "823a", law: "BGB" });
    expect(cite("§ 90a S. 1 BGB")[0]).toMatchObject({ section: "90a", pinpoints: [{ satz: "1" }] });
    expect(cite("§ 573 c Abs. 1 BGB")[0]).toMatchObject({
      section: "573c",
      pinpoints: [{ absatz: "1" }],
      law: "BGB",
    });
  });

  it("mehrere Normen mit §§ teilen sich das Gesetz", () => {
    expect(cite("§§ 823, 826 BGB").map((c) => [c.section, c.text, c.law])).toEqual([
      ["823", "§§ 823", "BGB"],
      ["826", "826", "BGB"],
    ]);
    expect(cite("§§ 823, 826 BGB")[1].group).toBe("§§ 823, 826 BGB");
  });

  it("Aufzählungen: wann eine Zahl die nächste Norm ist", () => {
    const expected = [
      ["280", [{ absatz: "1" }, { absatz: "3" }]],
      ["283", []],
    ];
    expect(cite("§§ 280 I, III, 283 BGB").map((c) => [c.section, c.pinpoints])).toEqual(expected);
    expect(cite("§§ 280 Abs. 1, 3, 283 BGB").map((c) => [c.section, c.pinpoints])).toEqual(
      expected
    );
    // Absteigend: die zweite Norm darf nicht als Absatz oder Nummer der ersten gelesen werden.
    expect(cite("§§ 280 Abs. 1, 241 Abs. 2 BGB").map((c) => [c.section, c.pinpoints])).toEqual([
      ["280", [{ absatz: "1" }]],
      ["241", [{ absatz: "2" }]],
    ]);
    expect(cite("§§ 437 Nr. 2, 323 I BGB").map((c) => [c.section, c.pinpoints])).toEqual([
      ["437", [{ nr: "2" }]],
      ["323", [{ absatz: "1" }]],
    ]);
    expect(sections("§§ 823 Abs. 1, 31 BGB")).toEqual([
      ["823", "BGB"],
      ["31", "BGB"],
    ]);
    expect(sections("§ 346 I, 437 Nr. 2, 440, 323 I BGB").map(([s]) => s)).toEqual([
      "346",
      "437",
      "440",
      "323",
    ]);
  });

  it("bei einfachem § gehören weitere kleine Zahlen zur Ebene", () => {
    expect(cite("§ 1 Abs. 2, 3 HGB")[0].pinpoints).toEqual([{ absatz: "2" }, { absatz: "3" }]);
    expect(cite("§ 1 Abs. 2 und Abs. 3 HGB")[0].pinpoints).toEqual([
      { absatz: "2" },
      { absatz: "3" },
    ]);
    expect(cite("§ 1 Abs. 2, 3 S. 1 HGB")[0].pinpoints).toEqual([
      { absatz: "2" },
      { absatz: "3", satz: "1" },
    ]);
  });

  it("verkettete Zitate", () => {
    expect(sections("§ 280 I, § 241 II BGB")).toEqual([
      ["280", "BGB"],
      ["241", "BGB"],
    ]);
    expect(sections("§ 823 II BGB i.V.m. § 263 StGB")).toEqual([
      ["823", "BGB"],
      ["263", "StGB"],
    ]);
    expect(sections("§ 280 I i.V.m. 241 II BGB")).toEqual([
      ["280", "BGB"],
      ["241", "BGB"],
    ]);
    expect(sections("§§ 437 Nr. 1, 439 BGB, 377 HGB")).toEqual([
      ["437", "BGB"],
      ["439", "BGB"],
      ["377", "HGB"],
    ]);
    // Ein Gesetz hinter einem Artikel gilt nicht für den Paragrafen davor.
    expect(sections("§ 823 Abs. 2 i.V.m. Art. 2 Abs. 1 GG")).toEqual([
      ["823", undefined],
      ["2", "GG"],
    ]);
  });

  it("ff., Bereiche und alte Fassung", () => {
    expect(cite("§§ 1 ff. HGB")[0]).toMatchObject({
      section: "1",
      following: "ff",
      law: "HGB",
      text: "§§ 1 ff.",
    });
    expect(cite("§§ 249ff. BGB")[0]).toMatchObject({ section: "249", following: "ff", law: "BGB" });
    expect(cite("§ 459 f. BGB")[0]).toMatchObject({ section: "459", following: "f" });
    expect(cite("§ 343f. HGB")[0]).toMatchObject({ section: "343", following: "f", law: "HGB" });
    expect(cite("§ 651f BGB")[0]).toMatchObject({ section: "651f", law: "BGB" });
    expect(cite("§§ 3 bis 6 BGB").map((c) => [c.section, c.rangeTo])).toEqual([
      ["3", "6"],
      ["6", undefined],
    ]);
    expect(cite("§§ 104–113 BGB").map((c) => [c.section, c.rangeTo, c.law])).toEqual([
      ["104", "113", "BGB"],
      ["113", undefined, "BGB"],
    ]);
    expect(cite("§ 280 Abs. 1–3 BGB")[0].pinpoints).toEqual([
      { absatz: "1" },
      { absatz: "2" },
      { absatz: "3" },
    ]);
    expect(cite("§ 476 BGB a.F.")[0]).toMatchObject({
      law: "BGB",
      oldVersion: true,
      group: "§ 476 BGB a.F.",
    });
    expect(cite("§ 476 a.F. BGB")[0]).toMatchObject({ law: "BGB", oldVersion: true });
  });

  it("Artikel", () => {
    expect(cite("Art. 1 Abs. 1 GG")[0]).toMatchObject({
      unit: "Art",
      section: "1",
      pinpoints: [{ absatz: "1" }],
      law: "GG",
    });
    expect(sections("Artt. 2 I, 1 I GG")).toEqual([
      ["2", "GG"],
      ["1", "GG"],
    ]);
    expect(cite("Art. 229 § 5 S. 1 EGBGB")[0]).toMatchObject({
      unit: "§",
      article: "229",
      section: "5",
      law: "EGBGB",
    });
    expect(cite("Art. 6 Abs. 1 UAbs. 1 lit. f DSGVO")[0]).toMatchObject({
      pinpoints: [{ absatz: "1", unterabsatz: "1", buchstabe: "f" }],
      law: "DSGVO",
    });
  });

  it("Schreibweisen aus Word: geschützte Leerzeichen, fehlende Leerzeichen, Zeilenumbruch", () => {
    expect(cite("§\u00a0433 Abs.\u00a01 BGB")[0]).toMatchObject({
      section: "433",
      pinpoints: [{ absatz: "1" }],
      law: "BGB",
    });
    expect(cite("§433 Abs.1 S.2 BGB")[0]).toMatchObject({
      section: "433",
      pinpoints: [{ absatz: "1", satz: "2" }],
      law: "BGB",
    });
    expect(sections("§§ 823,826 BGB")).toEqual([
      ["823", "BGB"],
      ["826", "BGB"],
    ]);
    expect(cite("§ 433 Abs. 1\u000bS. 1 BGB")[0].pinpoints).toEqual([{ absatz: "1", satz: "1" }]);
  });

  it("Gesetz vor dem Paragrafen (Kommentarzitate) und nach Artikel", () => {
    expect(cite("BeckOK BGB/Faust, BGB § 437 Rn. 10")[0]).toMatchObject({
      section: "437",
      law: "BGB",
      group: "BGB § 437",
    });
    expect(cite("§ 433 des BGB")[0]).toMatchObject({ law: "BGB", lawText: "des BGB" });
  });

  it("ohne Gesetzesangabe bleibt das Gesetz leer", () => {
    expect(cite("siehe § 433")[0].law).toBeUndefined();
    expect(cite("siehe § 433", { defaultLaw: "BGB" })[0].law).toBe("BGB");
  });

  it("keine Treffer ohne Normnummer", () => {
    expect(cite("Das § ist ein Zeichen.")).toEqual([]);
    expect(cite("BGBl. I S. 42, Absatz 1 Satz 2")).toEqual([]);
    expect(cite("nach Absatz 1 Satz 1 Nummer 2")).toEqual([]);
    expect(cite("Die Art und Weise der Leistung.")).toEqual([]);
  });

  it("Abkürzungen, die keine Gesetze sind", () => {
    for (const text of ["§ 5 GmbH", "§ 433 RdNr. 5", "§ 4 OLG", "§ 3 USA", "§ 126b E-Mail"]) {
      expect(cite(text)[0].law, text).toBeUndefined();
    }
    expect(cite("§ 433 BGB-Kaufvertrag")[0].law).toBe("BGB");
  });
});

describe("Verweise im Gesetzestext", () => {
  const bgb = { defaultLaw: "BGB" };
  const hgb = { defaultLaw: "HGB" };

  it("Nummern mit oder und weitere Norm", () => {
    expect(
      cite("dessen Vaterschaft nach § 1592 Nummer 1 oder 2 oder § 1593 besteht", bgb).map((c) => [
        c.section,
        c.pinpoints,
        c.law,
      ])
    ).toEqual([
      ["1592", [{ nr: "1" }, { nr: "2" }], "BGB"],
      ["1593", [], "BGB"],
    ]);
  });

  it("lange Aufzählung mit Artikeln (des, der) und sowie", () => {
    const text =
      "Die Vorschriften des § 26 Absatz 2 Satz 1, des § 27 Absatz 1 und 3, der §§ 28, 31a Abs. 1 Satz 2 sowie der §§ 32, 33 und 38 finden";
    expect(cite(text, bgb).map((c) => [c.section, c.pinpoints])).toEqual([
      ["26", [{ absatz: "2", satz: "1" }]],
      ["27", [{ absatz: "1" }, { absatz: "3" }]],
      ["28", []],
      ["31a", [{ absatz: "1", satz: "2" }]],
      ["32", []],
      ["33", []],
      ["38", []],
    ]);
  });

  it("Aufzählungen mit bis werden aufgefüllt", () => {
    const text =
      "Artikel 246a § 1 Absatz 1 Satz 1 Nummer 1, 5 bis 8, 11a, 14 und 15 des Einführungsgesetzes zum Bürgerlichen Gesetzbuche";
    const [c] = cite(text, bgb);
    expect(c.pinpoints.map((p) => p.nr)).toEqual(["1", "5", "6", "7", "8", "11a", "14", "15"]);
    expect(c).toMatchObject({ article: "246a", section: "1", law: "EGBGB" });
    expect(
      cite("§ 341r Nummer 3 Buchstabe a bis d", hgb)[0].pinpoints.map((p) => p.buchstabe)
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("ausgeschriebene Gesetze", () => {
    expect(cite("§ 1 des Handelsgesetzbuchs", bgb)[0]).toMatchObject({
      law: "HGB",
      lawText: "des Handelsgesetzbuchs",
    });
    expect(cite("§ 2 dieses Gesetzes", hgb)[0]).toMatchObject({ law: "HGB" });
    expect(cite("§ 76 des Aktiengesetzes", hgb)[0]).toMatchObject({ law: "AktG" });
    expect(cite("Artikel 15 der Verordnung (EU) 2016/679", bgb)[0]).toMatchObject({
      unit: "Art",
      section: "15",
      lawText: "der Verordnung",
    });
  });

  it("fremde Gesetze bekommen kein Standardgesetz", () => {
    const external = [
      "nach § 185a des Gesetzes über das Verfahren in Familiensachen",
      "nach den §§ 1 bis 6 des Vormünder- und Betreuervergütungsgesetzes",
      "(§ 22 des Justizvergütungs- und -entschädigungsgesetzes)",
      "nach § 12 des eID-Karte-Gesetzes",
      "§ 3 Absatz 1 der EG-Fahrzeuggenehmigungsverordnung",
      "Artikel 9 der Richtlinie 97/7/EG",
      "nach Artikel 6 Absatz 1 Buchstabe b des Haftungsbeschränkungsübereinkommens",
      "Artikel 16 Absatz 2 Unterabsatz 2 oder 3 der Verordnung (EU) Nr. 537/2014",
      "gilt die Vorschrift des § 51 Abs. 5 in Verbindung mit Muster 2 der Versicherungsunternehmens-Rechnungslegungsverordnung",
      "soweit sie nach dessen § 2 Absatz 1, 4 oder 5 von der Anwendung nicht ausgenommen sind",
      "Auskunftsrecht nach Artikel 15 Absatz 1",
    ];
    for (const text of external) {
      for (const c of cite(text, hgb)) expect(c.law, text).toBeUndefined();
    }
  });

  it("Paragrafen vor einem EGBGB-Artikel bleiben im eigenen Gesetz", () => {
    const text =
      "§ 312d Absatz 1 in Verbindung mit Artikel 246a § 1 Absatz 2 und 3 des Einführungsgesetzes zum Bürgerlichen Gesetzbuche";
    expect(cite(text, bgb).map((c) => [c.section, c.article, c.law])).toEqual([
      ["312d", undefined, "BGB"],
      ["1", "246a", "EGBGB"],
    ]);
    const sameArticle =
      "Artikel 248 §§ 1 bis 12, 13 Absatz 1, 3 bis 5 und §§ 14 bis 16 des Einführungsgesetzes zum Bürgerlichen Gesetzbuche";
    expect(cite(sameArticle, bgb).every((c) => c.article === "248" && c.law === "EGBGB")).toBe(
      true
    );
  });

  it("Bereiche zwischen Paragrafen mit eigenem Zeichen", () => {
    const text =
      "§ 114 Absatz 1 bis § 116 Absatz 2, den §§ 117, 118 Absatz 4 und § 127 des Wertpapierhandelsgesetzes";
    const found = cite(text, hgb);
    expect(found.map((c) => c.section)).toEqual(["114", "116", "117", "118", "127"]);
    expect(found[0].rangeTo).toBe("116");
    for (const c of found) expect(c.lawText).toBe("des Wertpapierhandelsgesetzes");
  });
});

describe("citationAt", () => {
  const text = "Siehe §§ 823, 826 BGB. Danach § 1 HGB.";
  const at = (needle: string, delta = 0) => citationAt(text, text.indexOf(needle) + delta)?.section;

  it("findet die Norm unter dem Cursor", () => {
    expect(at("823")).toBe("823");
    expect(at("826", 2)).toBe("826");
    expect(at("§ 1")).toBe("1");
  });

  it("zwischen Normen und auf dem Gesetz gilt die Norm davor", () => {
    expect(at("BGB")).toBe("826");
    expect(at("BGB", 3)).toBe("826");
    expect(at("§§")).toBe("823");
  });

  it("außerhalb von Zitaten nichts", () => {
    expect(at("Siehe")).toBeUndefined();
    expect(at("Danach")).toBeUndefined();
    expect(at(". Danach", 1)).toBeUndefined();
    expect(citationAt(text, text.length)).toBeUndefined();
  });

  it("zwei Zitate direkt hintereinander", () => {
    const two = "(§ 1 BGB)(§ 2 HGB)";
    expect(citationAt(two, two.indexOf("BGB") + 3)?.law).toBe("BGB");
    expect(citationAt(two, two.indexOf("§ 2"))?.law).toBe("HGB");
  });
});

describe("Korpus: alle Verweise in BGB und HGB", () => {
  const laws = ["bgb", "hgb"].map(
    (slug) => JSON.parse(readFileSync(`src/data/${slug}.json`, "utf8")) as LawFile
  );
  const strings = (content: Inline[]): string[] =>
    content.flatMap((inline) =>
      typeof inline === "string" ? [inline] : inline.items.flatMap((item) => strings(item.content))
    );

  /** Alle Zitate aus dem Normtext, mit Gesetz, zitierender Norm und Text. */
  const all = laws.flatMap((law) =>
    law.norms.flatMap((norm) =>
      norm.paragraphs
        .flatMap((p) => strings(p.content))
        .flatMap((text) =>
          findCitations(text, { defaultLaw: law.abbr }).map((c) => ({ law, norm, text, c }))
        )
    )
  );
  /** Verweise auf einen Paragrafen im eigenen Gesetz (ohne Artikel). */
  const ownLaw = all.filter(({ law, c }) => c.unit === "§" && !c.article && c.law === law.abbr);
  const describe = (e: (typeof all)[number]) =>
    `${e.law.abbr} ${e.norm.label} → § ${e.c.section}: ${e.text.slice(e.c.groupStart, e.c.groupEnd)}`;

  it("jedes §-Zeichen gehört zu einem Zitat", () => {
    const uncovered: string[] = [];
    for (const law of laws) {
      for (const norm of law.norms) {
        for (const text of norm.paragraphs.flatMap((p) => strings(p.content))) {
          const citations = findCitations(text, { defaultLaw: law.abbr });
          for (let i = text.indexOf("§"); i >= 0; i = text.indexOf("§", i + 1)) {
            if (!citations.some((c) => c.groupStart <= i && i < c.groupEnd))
              uncovered.push(`${law.abbr} ${norm.label}: …${text.slice(i, i + 40)}`);
          }
        }
      }
    }
    expect(uncovered).toEqual([]);
  });

  it("Verweise ins eigene Gesetz führen zu existierenden Normen", () => {
    expect(ownLaw.length).toBeGreaterThan(4000);
    const unresolved = ownLaw
      .filter(({ law, c }) => !law.norms.some((n) => n.id === c.section))
      .map(describe);
    // Bekannte Grenzen: Das Gesetz ergibt sich hier nur aus dem Satzzusammenhang.
    expect(unresolved).toEqual([
      // Listenpunkte unter "folgende Vorschriften des Handelsgesetzbuchs:" (Einleitung steht in einem anderen Textteil)
      "BGB § 707b → § 8a: §§ 8, 8a Absatz 1, § 9 Absatz 1 Satz 1 und Absatz 3 bis 6, die §§ 10 bis 12, 13h, 14, 16 und 32",
      "BGB § 707b → § 13h: §§ 8, 8a Absatz 1, § 9 Absatz 1 Satz 1 und Absatz 3 bis 6, die §§ 10 bis 12, 13h, 14, 16 und 32",
      "BGB § 707b → § 13d: §§ 13 und 13d",
      // "dieses Gesetzes" meint hier das zuvor genannte Kreditwesengesetz, sonst im Korpus immer das eigene Gesetz
      "HGB § 340 → § 53c: § 53c Nr. 1 dieses Gesetzes",
    ]);
  });

  it("zitierte Absätze und Nummern gibt es in der Zielnorm", () => {
    const hasAbsatz = (norm: Norm, absatz: string) => norm.paragraphs.some((p) => p.num === absatz);
    const hasNr = (norm: Norm, nr: string, absatz?: string) =>
      norm.paragraphs
        .filter((p) => !absatz || p.num === absatz || !p.num)
        .some((p) =>
          p.content.some(
            (i) => typeof i !== "string" && i.items.some((item) => item.label === `${nr}.`)
          )
        );
    const invalid: string[] = [];
    let checked = 0;
    for (const e of ownLaw) {
      const target = e.law.norms.find((n) => n.id === e.c.section);
      if (!target || target.repealed) continue;
      for (const p of e.c.pinpoints) {
        if (p.absatz && target.paragraphs.some((x) => x.num)) {
          checked++;
          if (!hasAbsatz(target, p.absatz)) invalid.push(`${describe(e)} (Abs. ${p.absatz})`);
        }
        if (p.nr) {
          checked++;
          if (!hasNr(target, p.nr, p.absatz)) invalid.push(`${describe(e)} (Nr. ${p.nr})`);
        }
      }
    }
    expect(checked).toBeGreaterThan(2500);
    // Bekannte Grenzen, alle mit Gesetz nur aus dem Satzzusammenhang: § 707b BGB und § 340 HGB (siehe oben) …
    const known = invalid.filter(
      (line) => !line.startsWith("BGB § 707b") && !line.startsWith("HGB § 340 → § 1:")
    );
    expect(known).toEqual([
      // … und hier, wo das Gesetz erst hinter einem zweiten Verweis steht:
      // "Sachen im Sinne des § 811 Absatz 1 Nummer 1 Buchstabe b und Tiere im Sinne des § 811 … der Zivilprozessordnung"
      "BGB § 592 → § 811: § 811 Absatz 1 Nummer 1 Buchstabe b (Nr. 1)",
    ]);
  });

  it("Paragrafen ohne Artikel werden nie einem Einführungsgesetz zugeordnet", () => {
    const wrong = all
      .filter(({ c }) => c.unit === "§" && !c.article && /^EG/.test(c.law ?? ""))
      .map(describe);
    expect(wrong).toEqual([]);
  });

  it("Artikel bekommen nie das Standardgesetz (BGB und HGB haben keine Artikel)", () => {
    const wrong = all.filter(({ law, c }) => c.unit === "Art" && c.law === law.abbr).map(describe);
    expect(wrong).toEqual([]);
  });
});
