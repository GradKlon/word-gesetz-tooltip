import { describe, expect, it } from "vitest";
import { citationAt, findCitations } from "./citationParser";
import type { Citation } from "./citationParser";

/*
 * Zitate, wie sie in Gutachten, Hausarbeiten, Urteilen, Schriftsätzen und Kommentaren stehen.
 * Kurzschreibweise des Ergebnisses: "§280[a1s2|a3] BGB" = § 280 Abs. 1 S. 2 und Abs. 3 BGB;
 * a = Absatz, u = Unterabsatz, s = Satz, h = Halbsatz, n = Nummer, b = Buchstabe, v = Alternative;
 * "ff"/"f" = ff./f., "-7" = Bereich bis 7, "§229§5" = Art. 229 § 5, "?" = kein Gesetz, "aF" = alte Fassung.
 */

const LEVELS = ["absatz", "unterabsatz", "satz", "halbsatz", "nr", "buchstabe", "alt"] as const;
const KEY: Record<(typeof LEVELS)[number], string> = {
  absatz: "a",
  unterabsatz: "u",
  satz: "s",
  halbsatz: "h",
  nr: "n",
  buchstabe: "b",
  alt: "v",
};

function short(c: Citation): string {
  let s = (c.unit === "Art" ? "Art" : "§") + (c.article ? c.article + "§" : "") + c.section;
  if (c.following) s += c.following;
  if (c.rangeTo) s += "-" + c.rangeTo;
  if (c.pinpoints.length > 0) {
    const parts = c.pinpoints.map((p) =>
      LEVELS.filter((l) => p[l] !== undefined)
        .map((l) => KEY[l] + p[l])
        .join("")
    );
    s += `[${parts.join("|")}]`;
  }
  s += " " + (c.law ?? "?");
  if (c.oldVersion) s += " aF";
  return s;
}

/** [Kategorie, Text, erwartetes Ergebnis (oder mehrere zulässige), Cursorproben [Suchtext, erwartet, Versatz]] */
type Entry = [string, string, string | string[], [string, string, number?][]?];
const CASES: Entry[] = [
  // --- Gutachten / Klausur: basics
  [
    "basic",
    "K könnte gegen V einen Anspruch auf Übergabe und Übereignung aus § 433 Abs. 1 S. 1 BGB haben.",
    "§433[a1s1] BGB",
    [
      ["433", "§433[a1s1] BGB"],
      ["BGB", "§433[a1s1] BGB"],
    ],
  ],
  ["basic", "K könnte gegen V einen Anspruch aus § 433 I 1 BGB haben.", "§433[a1s1] BGB"],
  ["basic", "V hat gegen K einen Anspruch auf Kaufpreiszahlung gem. § 433 II BGB.", "§433[a2] BGB"],
  ["basic", "Fraglich ist, ob ein Anspruch aus § 433 II Alt. 1 BGB besteht.", "§433[a2v1] BGB"],
  ["basic", "Dies folgt aus § 280 Abs. 1 S. 2 BGB.", "§280[a1s2] BGB"],
  ["basic", "Ein Anspruch aus § 823 Abs. 1 BGB analog scheidet aus.", "§823[a1] BGB"],
  ["basic", "Leistungskondiktion gem. § 812 I 1 Alt. 1 BGB", "§812[a1s1v1] BGB"],
  ["basic", "nach § 812 Abs. 1 Satz 1 Alt. 1 BGB", "§812[a1s1v1] BGB"],
  ["basic", "gem. § 433 BGB", "§433 BGB"],
  ["basic", "(§ 433 BGB)", "§433 BGB"],
  ["basic", "(vgl. § 433 BGB).", "§433 BGB"],
  ["basic", "§ 433 BGB Rn. 3", "§433 BGB"],
  ["basic", "Der Käufer muss nach § 377 HGB rügen.", "§377 HGB"],
  ["basic", "§ 25 Abs. 1 S. 1 HGB", "§25[a1s1] HGB"],
  ["basic", "§ 433 Abs. 1 Satz 1 Hs. 2 BGB", "§433[a1s1h2] BGB"],
  ["basic", "§ 439 Abs. 3 S. 1 Halbs. 2 BGB", "§439[a3s1h2] BGB"],
  ["basic", "§ 433 Abs. 1 Satz 1 Var. 2 BGB", "§433[a1s1v2] BGB"],
  ["basic", "§ 312 Abs. 2 Nr. 3 Buchst. b BGB", "§312[a2n3bb] BGB"],
  ["basic", "§ 309 Nr. 7 lit. b BGB", "§309[n7bb] BGB"],
  ["basic", "§ 1 Abs. 1 S. 2 Nr. 1 lit. a", "§1[a1s2n1ba] ?"],
  ["basic", "§ 433 Abs. 1 S. 1, Abs. 2 BGB", "§433[a1s1|a2] BGB"],
  ["basic", "§ 307 Abs. 1 Satz 1, Abs. 2 Nr. 1 BGB", "§307[a1s1|a2n1] BGB"],
  ["basic", "§ 286 Abs. 2 Nr. 1, Abs. 3 BGB", "§286[a2n1|a3] BGB"],
  ["basic", "§ 434 I 2 Nr. 1 BGB", "§434[a1s2n1] BGB"],
  ["basic", "§ 434 Abs. 1 Satz 2 Nr. 2 BGB a.F.", "§434[a1s2n2] BGB aF"],
  ["basic", "§ 15 Abs. 1 HGB a.F.", "§15[a1] HGB aF"],
  ["basic", "§ 15 I HGB aF", "§15[a1] HGB aF"],
  ["basic", "§ 476 BGB a. F.", "§476 BGB aF"],
  ["basic", "§ 1004 I 1 BGB analog", "§1004[a1s1] BGB"],
  ["basic", "§ 323 V 2 BGB", "§323[a5s2] BGB"],
  ["basic", "§ 651i III Nr. 7 BGB", "§651i[a3n7] BGB"],
  ["basic", "§ 288 VI BGB", "§288[a6] BGB"],
  ["basic", "§ 1 X UWG", "§1[a10] UWG"],
  ["basic", "§ 241a BGB", "§241a BGB"],
  ["basic", "§ 312g Abs. 1 BGB", "§312g[a1] BGB"],
  ["basic", "§ 709 Satz 1 und 2 ZPO", "§709[s1|s2] ZPO"],
  ["basic", "§ 280 Abs. 1 und 2 BGB", "§280[a1|a2] BGB"],
  ["basic", "§ 433 I u. II BGB", "§433[a1|a2] BGB"],
  ["basic", "§ 1 Abs. 2, 3 HGB", "§1[a2|a3] HGB"],

  // --- multiple norms ascending
  [
    "list",
    "K könnte Schadensersatz statt der Leistung gem. §§ 280 I, III, 281 I 1 BGB verlangen.",
    "§280[a1|a3] BGB; §281[a1s1] BGB",
    [["281", "§281[a1s1] BGB"]],
  ],
  ["list", "gem. §§ 280 Abs. 1, 3, 281 Abs. 1 S. 1 BGB", "§280[a1|a3] BGB; §281[a1s1] BGB"],
  [
    "list",
    "Nacherfüllung gem. §§ 434, 437 Nr. 1, 439 BGB",
    "§434 BGB; §437[n1] BGB; §439 BGB",
    [["439", "§439 BGB"]],
  ],
  ["list", "nach §§ 133, 157 BGB auszulegen", "§133 BGB; §157 BGB"],
  ["list", "Der Anspruch ist gem. §§ 195, 199 Abs. 1 BGB verjährt.", "§195 BGB; §199[a1] BGB"],
  ["list", "gemäß §§ 708 Nr. 11, 711, 713 ZPO", "§708[n11] ZPO; §711 ZPO; §713 ZPO"],
  ["list", "§§ 929 S. 1, 932 I 1 BGB", "§929[s1] BGB; §932[a1s1] BGB"],
  ["list", "§§ 280 I, 241 II BGB", "§280[a1] BGB; §241[a2] BGB", [["241", "§241[a2] BGB"]]],
  ["list", "§§ 823 I, 253 II BGB", "§823[a1] BGB; §253[a2] BGB"],
  ["list", "§§ 280 I, II, 286 BGB", "§280[a1|a2] BGB; §286 BGB"],
  ["list", "§§ 280 Abs. 1 und 2, 286 BGB", "§280[a1|a2] BGB; §286 BGB"],
  ["list", "§§ 823 I, 1004 I 1 BGB analog", "§823[a1] BGB; §1004[a1s1] BGB"],
  ["list", "§§ 128, 161 Abs. 2 HGB", "§128 HGB; §161[a2] HGB"],
  [
    "list",
    "§§ 823, 826 BGB",
    "§823 BGB; §826 BGB",
    [
      ["826", "§826 BGB"],
      ["BGB", "§826 BGB"],
    ],
  ],

  // --- multiple norms where a later § number is smaller than the first
  [
    "desc",
    "K kann gem. §§ 437 Nr. 2, 323 I BGB zurücktreten.",
    "§437[n2] BGB; §323[a1] BGB",
    [["323", "§323[a1] BGB"]],
  ],
  [
    "desc",
    "K kann Schadensersatz gem. §§ 437 Nr. 3, 280 I, III, 281 I BGB verlangen.",
    "§437[n3] BGB; §280[a1|a3] BGB; §281[a1] BGB",
    [["280", "§280[a1|a3] BGB"]],
  ],
  [
    "desc",
    "Ein Anspruch aus §§ 280 Abs. 1, 241 Abs. 2 BGB kommt in Betracht.",
    "§280[a1] BGB; §241[a2] BGB",
    [["241", "§241[a2] BGB"]],
  ],
  [
    "desc",
    "Anspruch aus §§ 311 Abs. 2, 241 Abs. 2, 280 Abs. 1 BGB (c.i.c.)",
    "§311[a2] BGB; §241[a2] BGB; §280[a1] BGB",
    [["241", "§241[a2] BGB"]],
  ],
  [
    "desc",
    "Anspruch aus §§ 311 II Nr. 1, 241 II, 280 I BGB",
    "§311[a2n1] BGB; §241[a2] BGB; §280[a1] BGB",
    [["241", "§241[a2] BGB"]],
  ],
  [
    "desc",
    "Aufwendungsersatz aus GoA gem. §§ 677, 683 S. 1, 670 BGB",
    "§677 BGB; §683[s1] BGB; §670 BGB",
    [["670", "§670 BGB"]],
  ],
  [
    "desc",
    "Die Haftung des Vereins folgt aus §§ 823 Abs. 1, 31 BGB.",
    "§823[a1] BGB; §31 BGB",
    [["31 ", "§31 BGB"]],
  ],
  [
    "desc",
    "Haftung für den Gehilfen gem. §§ 280 Abs. 1, 278 BGB",
    "§280[a1] BGB; §278 BGB",
    [["278", "§278 BGB"]],
  ],
  ["desc", "gem. §§ 280 I 1, 278 BGB", "§280[a1s1] BGB; §278 BGB"],
  ["desc", "Schadensersatz nach §§ 823 Abs. 1, 249 ff. BGB", "§823[a1] BGB; §249ff BGB"],
  ["desc", "Schmerzensgeld gem. §§ 823 Abs. 1, 253 Abs. 2 BGB", "§823[a1] BGB; §253[a2] BGB"],
  ["desc", "Erwerb nach §§ 932 Abs. 1 S. 1, 929 S. 1 BGB", "§932[a1s1] BGB; §929[s1] BGB"],
  ["desc", "§§ 1004 Abs. 1 S. 1, 903 BGB", "§1004[a1s1] BGB; §903 BGB"],
  ["desc", "§§ 326 Abs. 5, 323 BGB", "§326[a5] BGB; §323 BGB"],
  ["desc", "§§ 161 Abs. 2, 105 Abs. 3 HGB", "§161[a2] HGB; §105[a3] HGB"],
  [
    "desc",
    "§§ 434 Abs. 1 S. 2 Nr. 2, 437 Nr. 2, 440, 326 Abs. 5, 323 BGB",
    "§434[a1s2n2] BGB; §437[n2] BGB; §440 BGB; §326[a5] BGB; §323 BGB",
  ],

  // --- single § with several norms (sloppy but common)
  [
    "single",
    "K kann gem. § 346 I, 437 Nr. 2, 440, 323 I BGB Rückzahlung verlangen.",
    "§346[a1] BGB; §437[n2] BGB; §440 BGB; §323[a1] BGB",
    [
      ["440", "§440 BGB"],
      ["323", "§323[a1] BGB"],
    ],
  ],
  [
    "single",
    "§ 437 Nr. 1, 439 Abs. 1 BGB",
    "§437[n1] BGB; §439[a1] BGB",
    [["439", "§439[a1] BGB"]],
  ],
  ["single", "§ 437 Nr. 2, 323 I BGB", "§437[n2] BGB; §323[a1] BGB"],
  ["single", "Anspruch aus § 280 I, III, 283 S. 1 BGB", "§280[a1|a3] BGB; §283[s1] BGB"],
  ["single", "§ 280 I, III, 281 I 1 BGB", "§280[a1|a3] BGB; §281[a1s1] BGB"],

  // --- chains
  [
    "chain",
    "§ 280 I i.V.m. § 241 II BGB",
    "§280[a1] BGB; §241[a2] BGB",
    [
      ["280", "§280[a1] BGB"],
      ["241", "§241[a2] BGB"],
    ],
  ],
  ["chain", "§ 280 I iVm § 241 II BGB", "§280[a1] BGB; §241[a2] BGB"],
  ["chain", "§ 280 Abs. 1 i. V. m. § 241 Abs. 2 BGB", "§280[a1] BGB; §241[a2] BGB"],
  ["chain", "§ 280 Abs. 1 in Verbindung mit § 241 Abs. 2 BGB", "§280[a1] BGB; §241[a2] BGB"],
  ["chain", "§ 823 II BGB i.V.m. § 263 StGB", "§823[a2] BGB; §263 StGB"],
  ["chain", "§ 823 Abs. 2 BGB iVm § 263 Abs. 1 StGB", "§823[a2] BGB; §263[a1] StGB"],
  ["chain", "§ 366 I HGB i.V.m. §§ 932 ff. BGB", "§366[a1] HGB; §932ff BGB"],
  ["chain", "Art. 2 I i.V.m. Art. 1 I GG", "Art2[a1] GG; Art1[a1] GG"],
  ["chain", "Art. 2 Abs. 1 i.V.m. Art. 1 Abs. 1 GG", "Art2[a1] GG; Art1[a1] GG"],
  ["chain", "§ 280 I i.V.m § 241 II BGB", "§280[a1] BGB; §241[a2] BGB"],
  ["chain", "Art. 2 I i.V.m. 1 I GG", "Art2[a1] GG; Art1[a1] GG", [["1 I GG", "Art1[a1] GG"]]],
  ["chain", "§ 13 BGB i.S.d. § 14", ["§13 BGB; §14 ?", "§13 BGB; §14 BGB"]],

  // --- several laws in one §§ group
  ["multilaw", "§§ 823 II BGB, 263 StGB", "§823[a2] BGB; §263 StGB", [["263", "§263 StGB"]]],
  ["multilaw", "Anspruch aus §§ 823 Abs. 2 BGB i.V.m. 263 StGB", "§823[a2] BGB; §263 StGB"],
  [
    "multilaw",
    "Nacherfüllung nach §§ 437 Nr. 1, 439 BGB, 377 HGB",
    "§437[n1] BGB; §439 BGB; §377 HGB",
    [["377", "§377 HGB"]],
  ],
  ["multilaw", "§§ 105 Abs. 3 HGB, 705 ff. BGB", "§105[a3] HGB; §705ff BGB"],

  // --- ff., f., ranges
  ["range", "vgl. §§ 1 ff. HGB", "§1ff HGB"],
  ["range", "§ 343 f. HGB", "§343f HGB"],
  ["range", "§§ 1 bis 7 HGB", "§1-7 HGB; §7 HGB"],
  ["range", "§§ 987 ff. BGB", "§987ff BGB"],
  ["range", "§§ 249ff. BGB", "§249ff BGB"],
  ["range", "§§ 1ff. HGB", "§1ff HGB"],
  ["range", "Art. 70ff. GG", "Art70ff GG"],
  ["range", "§§ 433 ff BGB", "§433ff BGB"],
  ["range", "§§ 651f. BGB", "§651f BGB"],
  ["range", "§§ 1–3 HGB", "§1-3 HGB; §3 HGB", [["HGB", "§3 HGB"]]],
  ["range", "§§ 1-3 HGB", "§1-3 HGB; §3 HGB"],
  ["range", "§§ 1 – 7 HGB", "§1-7 HGB; §7 HGB"],
  ["range", "Art. 1–19 GG", "Art1-19 GG; Art19 GG"],
  ["range", "§ 280 Abs. 1–3 BGB", "§280[a1|a2|a3] BGB"],
  ["range", "§ 433 I–III BGB", "§433[a1|a2|a3] BGB"],

  // --- ordinal / other variant keywords
  ["ordinal", "§ 812 I 1 1. Alt. BGB", "§812[a1s1v1] BGB", [["BGB", "§812[a1s1v1] BGB"]]],
  ["ordinal", "§ 812 Abs. 1 S. 1 2. Var. BGB", "§812[a1s1v2] BGB"],
  ["ordinal", "§ 812 Abs. 1 Satz 2 Fall 2 BGB", "§812[a1s2v2] BGB"],
  ["ordinal", "§ 439 Abs. 3 S. 1 2. Hs. BGB", "§439[a3s1h2] BGB"],
  ["ordinal", "§ 932 Abs. 2 2. Halbsatz BGB", "§932[a2h2] BGB"],
  ["ordinal", "§ 812 I 2 2. Alt. BGB", "§812[a1s2v2] BGB"],
  ["ordinal", "§ 4 Nr. 1 S. 2 UWG", "§4[s2n1] UWG"],
  ["ordinal", "§ 433 Abs. II BGB", "§433[a2] BGB"],

  // --- Urteil / Schriftsatz style
  [
    "urteil",
    "Dem Kläger steht gegen die Beklagte ein Anspruch auf Rückzahlung des Kaufpreises gemäß § 346 Abs. 1, § 437 Nr. 2, § 323 Abs. 1 BGB zu.",
    "§346[a1] BGB; §437[n2] BGB; §323[a1] BGB",
  ],
  [
    "urteil",
    "Die Revision ist gemäß § 543 Abs. 2 Satz 1 Nr. 1 ZPO zuzulassen.",
    "§543[a2s1n1] ZPO",
  ],
  ["urteil", "Die Kostenentscheidung beruht auf § 91 Abs. 1 Satz 1 ZPO.", "§91[a1s1] ZPO"],
  [
    "urteil",
    "Der Anspruch folgt aus § 280 Abs. 1 und 3, § 281 Abs. 1 Satz 1 BGB.",
    "§280[a1|a3] BGB; §281[a1s1] BGB",
  ],
  ["urteil", "Die Voraussetzungen des § 377 Abs. 1 HGB liegen vor.", "§377[a1] HGB"],
  ["urteil", "im Sinne von § 343 Abs. 1 HGB", "§343[a1] HGB"],
  ["urteil", "in entsprechender Anwendung des § 31 BGB", "§31 BGB"],
  [
    "urteil",
    "Die Entscheidung über die vorläufige Vollstreckbarkeit beruht auf §§ 708 Nr. 10, 711 ZPO.",
    "§708[n10] ZPO; §711 ZPO",
  ],
  ["urteil", "Zinsen seit dem 1.1.2020 (§§ 286, 288 Abs. 1 BGB).", "§286 BGB; §288[a1] BGB"],
  ["urteil", "gemäß § 25 Abs. 1 Satz 1 HGB", "§25[a1s1] HGB"],
  ["urteil", "Eine Haftung nach § 128 Satz 1 HGB besteht.", "§128[s1] HGB"],
  ["schrift", "Der Anspruch ergibt sich aus §§ 631, 632 BGB.", "§631 BGB; §632 BGB"],
  [
    "schrift",
    "Hilfsweise wird der Anspruch auf § 812 Abs. 1 S. 1 Alt. 1 BGB gestützt.",
    "§812[a1s1v1] BGB",
  ],
  ["schrift", "Das Landgericht ist gemäß §§ 12, 13 ZPO örtlich zuständig.", "§12 ZPO; §13 ZPO"],
  ["schrift", "nebst Zinsen gem. §§ 288 I, 291 BGB", "§288[a1] BGB; §291 BGB"],
  ["schrift", "Das Bestreiten mit Nichtwissen ist unzulässig (§ 138 Abs. 4 ZPO).", "§138[a4] ZPO"],
  ["schrift", "Die Klage ist als Feststellungsklage zulässig, § 256 Abs. 1 ZPO.", "§256[a1] ZPO"],

  // --- Grundgesetz / Hausarbeit ÖR
  [
    "gg",
    "Gemäß Art. 20 Abs. 3 GG ist die Verwaltung an Recht und Gesetz gebunden.",
    "Art20[a3] GG",
  ],
  ["gg", "Art. 14 Abs. 1 S. 1 GG", "Art14[a1s1] GG"],
  ["gg", "Art. 101 Abs. 1 Satz 2 GG", "Art101[a1s2] GG"],
  ["gg", "Art. 5 III 1 Var. 1 GG", "Art5[a3s1v1] GG"],
  ["gg", "Art. 12 I GG", "Art12[a1] GG"],
  ["gg", "Artikel 3 Absatz 1 des Grundgesetzes", "Art3[a1] GG"],
  ["gg", "Artt. 2 I, 1 I GG", "Art2[a1] GG; Art1[a1] GG"],
  ["gg", "Art. 229 § 5 Satz 1 EGBGB", "§229§5[s1] EGBGB"],
  ["gg", "Art. 246a § 1 Abs. 1 S. 1 Nr. 1 EGBGB", "§246a§1[a1s1n1] EGBGB"],
  ["gg", "Art. 6 Abs. 1 UAbs. 1 lit. f DSGVO", "Art6[a1u1bf] DSGVO"],
  ["gg", "Art. 6 Abs. 1 S. 1 lit. f DSGVO", "Art6[a1s1bf] DSGVO"],

  // --- UWG/GmbHG/HGB Hausarbeit
  ["other", "§ 4 Nr. 3 lit. a UWG", "§4[n3ba] UWG"],
  ["other", "§ 5 Abs. 1 S. 2 Nr. 1 UWG", "§5[a1s2n1] UWG"],
  ["other", "§ 8 Abs. 3 Nr. 2 UWG", "§8[a3n2] UWG"],
  ["other", "§ 13 Abs. 1 GmbHG", "§13[a1] GmbHG"],
  ["other", "§ 35 Abs. 1 S. 1 GmbHG", "§35[a1s1] GmbHG"],
  ["other", "§ 105 Abs. 1 HGB", "§105[a1] HGB"],
  ["other", "§ 1 II HGB", "§1[a2] HGB"],
  ["other", "§ 2 S. 1 HGB", "§2[s1] HGB"],
  ["other", "§§ 48 ff. HGB", "§48ff HGB"],
  ["other", "Die Prokura (§§ 48 ff. HGB) erlischt.", "§48ff HGB"],

  // --- commentary / footnotes
  [
    "komm",
    "1 BGH NJW 2005, 1234 (1235); MüKoBGB/Westermann, 8. Aufl. 2019, § 433 Rn. 5.",
    ["§433 ?", "§433 BGB"],
  ],
  ["komm", "MüKoBGB/Westermann § 433 Rn. 5", ["§433 ?", "§433 BGB"]],
  ["komm", "Palandt/Weidenkaff, BGB, 80. Aufl. 2021, § 433 Rn. 1.", ["§433 ?", "§433 BGB"]],
  [
    "komm",
    "BeckOK BGB/Faust, 65. Ed. 1.2.2023, BGB § 437 Rn. 10.",
    "§437 BGB",
    [["437", "§437 BGB"]],
  ],
  ["komm", "Baumbach/Hopt/Hopt, 41. Aufl. 2022, HGB § 377 Rn. 23.", "§377 HGB"],
  ["komm", "Grüneberg/Grüneberg, 82. Aufl. 2023, § 280 Rn. 4.", ["§280 ?", "§280 BGB"]],
  ["komm", "Staudinger/Beckmann (2013) § 433 Rn. 5", ["§433 ?", "§433 BGB"]],
  ["komm", "MüKoBGB/Westermann, 5. Aufl. 2008, § 433 RdNr. 5", ["§433 ?", "§433 BGB"]],
  ["komm", "Hopt in Baumbach/Hopt, § 343 HGB Rn. 1", "§343 HGB"],
  ["komm", "BGH NJW 2005, 1234 (1235)", ""],
  ["komm", "BGHZ 123, 45 (47); BVerfGE 65, 1 (43)", ""],
  ["komm", "§ 280 I 1 iVm § 276", "§280[a1s1] ?; §276 ?"],
  ["komm", "§ 476 aF", "§476 ? aF"],
  ["komm", "Wolf/Neuner, BGB AT, § 42 Rn. 5", "§42 ?"],
  ["komm", "§ 433 Rn. 5; s. auch § 434 Rn. 12.", "§433 ?; §434 ?"],

  // --- typography / layout
  ["typo", "§\u00a0433 Abs.\u00a01 S.\u00a01 BGB", "§433[a1s1] BGB"],
  ["typo", "§\u2009433\u2009I\u20091 BGB", "§433[a1s1] BGB"],
  ["typo", "§\u202f433 Abs.\u202f1 BGB", "§433[a1] BGB"],
  ["typo", "§§\u00a0280\u00a0I,\u00a0III,\u00a0281\u00a0BGB", "§280[a1|a3] BGB; §281 BGB"],
  ["typo", "§ § 280, 281 BGB", "§280 BGB; §281 BGB", [["§ §", "§280 BGB"]]],
  ["typo", "aus § 433 Abs. 1\nS. 1 BGB", "§433[a1s1] BGB"],
  ["typo", "aus § 433 Abs. 1\u000bS. 1 BGB", "§433[a1s1] BGB"],
  ["typo", "§ 573 c Abs. 1 BGB", "§573c[a1] BGB"],
  ["typo", "§ 90 a BGB", "§90a BGB"],
  ["typo", "§ 433 des BGB", "§433 BGB"],

  // --- Seite vs. Satz and other noise
  ["noise", "§ 433 BGB, BGBl. I S. 42", "§433 BGB"],
  ["noise", "BGBl. I S. 42, Absatz 1 Satz 2", ""],
  ["noise", "Gesetz vom 26.11.2001 (BGBl. I S. 3138), § 433 BGB", "§433 BGB"],
  ["noise", "Die Art und Weise der Leistung.", ""],
  ["noise", "Gemäß Ziff. 3 der AGB", ""],
  [
    "noise",
    "Der Verkäufer (V) und der Käufer (K) schließen einen Vertrag nach § 433 BGB.",
    "§433 BGB",
  ],
  ["noise", "Fraglich ist, ob V gem. § 433 II zur Zahlung verpflichtet ist.", "§433[a2] ?"],
  ["noise", "Gem. § 985 kann E von B Herausgabe verlangen.", "§985 ?"],
  ["noise", "Begründung zu § 433, BT-Drs. 14/6040, S. 208.", "§433 ?"],
];

describe("Zitierweisen aus der Praxis", () => {
  it.each(CASES)("[%s] %s", (_category, text, expected, cursors) => {
    const actual = findCitations(text).map(short).join("; ");
    if (Array.isArray(expected)) expect(expected).toContain(actual);
    else expect(actual).toBe(expected);
    for (const [needle, cursorExpected, delta] of cursors ?? []) {
      const found = citationAt(text, text.indexOf(needle) + (delta ?? 0));
      expect(found ? short(found) : "(keins)", `Cursor auf "${needle}"`).toBe(cursorExpected);
    }
  });
});
