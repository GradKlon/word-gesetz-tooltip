/*
 * Findet Normzitate in deutschem Rechtstext, z. B. "§ 433 Abs. 1 S. 2 BGB", "§§ 280 I, III, 283 BGB",
 * "Art. 1 Abs. 1 GG" oder Verweise im Gesetzestext wie "§ 1592 Nummer 1 oder 2 oder § 1593".
 *
 * Ein Zitat besteht aus einer Gruppe von Normen, die sich ein Gesetz teilen:
 *   "§ 280 I, § 241 II BGB"          → § 280 und § 241, beide BGB
 *   "§ 823 II BGB i.V.m. § 263 StGB" → § 823 BGB und § 263 StGB
 *   "§§ 437 Nr. 1, 439 BGB, 377 HGB" → § 437 und § 439 BGB, § 377 HGB
 *
 * Der Parser arbeitet mit Heuristiken; Grenzen sind in citationParser.test.ts dokumentiert.
 */

/** Genaue Stelle innerhalb einer Norm. Fehlende Felder bedeuten "ganze Ebene". */
export interface Pinpoint {
  absatz?: string;
  unterabsatz?: string;
  satz?: string;
  halbsatz?: string;
  nr?: string;
  buchstabe?: string;
  /** Alternative, Variante oder Fall. */
  alt?: string;
  /**
   * Satz und Halbsatz stehen innerhalb der Nummer bzw. des Buchstabens ("§ 569 Abs. 3 Nr. 2 S. 1"),
   * nicht darüber ("§ 434 Abs. 1 S. 2 Nr. 1").
   */
  withinNr?: true;
}

export interface Citation {
  /** "§" oder "Art" (Artikel). */
  unit: "§" | "Art";
  /** Nummer der Norm ohne Zeichen, z. B. "433" oder "90a". */
  section: string;
  /** Bei "Artikel 246a § 1": der Artikel ("246a"), in dem der Paragraf steht. */
  article?: string;
  /** Genaue Stellen; leer, wenn die ganze Norm zitiert ist. */
  pinpoints: Pinpoint[];
  /** "f." oder "ff." hinter der Nummer. */
  following?: "f" | "ff";
  /** Bei "§§ 1 bis 3": das Ende des Bereichs ("3"), gesetzt an der ersten Norm. */
  rangeTo?: string;
  /**
   * Gesetzeskürzel, z. B. "BGB": wie angegeben, aus dem ausgeschriebenen Namen abgeleitet
   * oder `defaultLaw`. Fehlt, wenn das Gesetz unbekannt ist (z. B. "des Gesetzes über …").
   */
  law?: string;
  /** Das Gesetz so, wie es im Text steht ("BGB", "des Aktiengesetzes"); fehlt, wenn keins angegeben ist. */
  lawText?: string;
  /** Zitat bezieht sich auf eine alte Fassung ("a.F."). */
  oldVersion?: true;
  /** Textbereich dieser Norm, z. B. "§ 433 Abs. 1 S. 2" oder bei "§§ 823, 826 BGB" nur "826". */
  start: number;
  end: number;
  /** Textbereich des ganzen Zitats einschließlich Gesetz, z. B. "§§ 823, 826 BGB". */
  groupStart: number;
  groupEnd: number;
}

export interface ParseOptions {
  /**
   * Gesetz für Paragrafen ohne Gesetzesangabe, z. B. "BGB" für Verweise im BGB-Text.
   * Gilt nicht für Artikel und nicht nach "dessen"/"deren" ("nach dessen § 2" meint ein anderes Gesetz).
   */
  defaultLaw?: string;
}

/** Findet alle Zitate in `text`, sortiert nach Position. */
export function findCitations(text: string, options: ParseOptions = {}): Citation[] {
  const citations: Citation[] = [];
  const starter = /§|Art(?:t\.|ikel|\.)/g;
  let match: RegExpExecArray | null;
  while ((match = starter.exec(text))) {
    // "Art" nur am Wortanfang ("Kunstart." ist kein Artikel).
    if (match[0] !== "§" && /[\p{L}\d]/u.test(text.charAt(match.index - 1))) continue;
    const group = parseGroup(text, match.index, options);
    if (!group) continue;
    for (const citation of group) citations.push(citation);
    starter.lastIndex = Math.max(starter.lastIndex, group[0].groupEnd);
  }
  return citations;
}

/**
 * Das Zitat an einer Textposition, z. B. unter dem Cursor. Steht die Position im Zitat, aber zwischen
 * zwei Normen (etwa auf "BGB" in "§§ 823, 826 BGB"), wird die nächste Norm davor gewählt.
 */
export function citationAt(
  text: string,
  offset: number,
  options: ParseOptions = {}
): Citation | undefined {
  const inGroup = findCitations(text, options).filter(
    (c) => c.groupStart <= offset && offset <= c.groupEnd
  );
  return (
    inGroup.find((c) => c.start <= offset && offset <= c.end) ??
    inGroup.filter((c) => c.start <= offset).pop() ??
    inGroup[0]
  );
}

// ---------------------------------------------------------------------------------------------
// Bausteine. Alle Muster sind "sticky", passen also nur genau an der aktuellen Position.

/** Hinter Wörtern darf kein Buchstabe und keine Ziffer folgen ("Abs" nicht in "Absicht"). */
const word = (source: string): string => `(?:${source})(?![\\p{L}\\d])`;
/** Alternativen; die auf Wörter enden, mit `word()` absichern, die auf "." oder "," enden, nicht ("Abs.1"). */
const pattern = (...alternatives: string[]): RegExp =>
  new RegExp(`(?:${alternatives.join("|")})`, "yu");

const SPACE = /[\s\u00a0\u202f\u2009\u00ad]*/y;
const DIGITS = /\d+/y;
const SECTION_SIGN = /§(?:[ \u00a0]?§)?/y;
const ARTICLE = pattern("Artt\\.", word("Artikeln|Artikels|Artikel"), "Art\\.");
const PIN_NUMBER = pattern(word("(\\d+)([a-z]?)"));
const ROMAN = pattern(word("(XX|X?(?:IX|IV|V?I{0,3}))"));
const FOLLOWING = pattern("(ff?)\\.", word("(ff)"));
const OLD_VERSION = pattern("a\\.\\s?F\\.", word("aF"));
const LIST_SEPARATOR = pattern(",", word("und|oder|sowie"), "bzw\\.", "u\\.");
const RANGE = pattern(word("bis"), "[–—-]");
const CHAIN = pattern(
  "i\\.\\s?V\\.\\s?m\\.?",
  "iVm\\.",
  word("iVm"),
  word("(?:auch |jeweils )?in Verbindung mit")
);
const DETERMINER = pattern(word("des|der|den|dem|die|das"));
const LAW_DETERMINER = pattern(word("des|der|dieses"));
const LAW_ABBREVIATION = pattern(word("[A-ZÄÖÜ][\\p{L}]*(?:-[\\p{L}]+)*"));
const WORD = pattern(word("-?[\\p{L}][\\p{L}-]*"));
const CONJUNCTION = pattern(word("und|oder"));
const LAW_NAME_CONNECTOR = pattern(word("zum|zur"));
/** "in Verbindung mit Muster 2 der …verordnung": keine Norm, aber das Gesetz dahinter zählt. */
const NON_NORM_REFERENCE = pattern(
  word("(?:Muster|Anlage|Anhang|Formblatt|Tabelle)\\s+\\d+[a-z]?")
);

const LEVELS = ["absatz", "unterabsatz", "satz", "halbsatz", "nr", "buchstabe", "alt"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_KEYWORDS: [RegExp, Level][] = [
  [
    pattern(word("Unterabsätze|Unterabsatzes|Unterabsatz"), "Unterabs\\.", "UAbs\\.", word("UAbs")),
    "unterabsatz",
  ],
  [pattern(word("Absätze|Absatzes|Absatz"), "Abs\\.", word("Abs")), "absatz"],
  [pattern(word("Halbsatz"), "Halbs\\.", "Hs\\.", "HS\\.", word("Hs|HS")), "halbsatz"],
  [pattern(word("Sätze|Satzes|Satz"), "S\\.", word("S")), "satz"],
  [pattern(word("Nummern|Nummer|Ziffern|Ziffer"), "Nrn\\.", "Nr\\.", "Ziff\\.", word("Nr")), "nr"],
  [pattern(word("Buchstaben|Buchstabe"), "Buchst\\.", "lit\\.", word("Buchst|lit")), "buchstabe"],
  [pattern(word("Alternative|Variante|Fall"), "Alt\\.", "Var\\.", word("Alt|Var")), "alt"],
];
/** "1. Alt.", "2. Var.", "2. Hs.": die Zahl steht vor der Bezeichnung. */
const ORDINAL_LEVEL = pattern(
  `(\\d+)\\.\\s?(${["Alt\\.", "Var\\.", "Hs\\.", "HS\\.", "Halbs\\.", word("Alternative|Variante|Fall|Halbsatz|Alt|Var|Hs|HS")].join("|")})`
);
const LETTER = pattern("([a-zA-Z])\\)", word("([a-zA-Z])"));

/** Kürzel, die nicht auf G, O, V oder B enden, aber Gesetze sind. */
const KNOWN_LAWS = new Set(["EMRK", "GRCh", "EUV", "AEUV", "EG", "EGV"]);
/** Wörter, die wie Gesetzeskürzel aussehen, aber keine sind (Gerichte, Gesellschaftsformen, Fundstellen). */
const NOT_A_LAW = new Set([
  ...["AG", "KG", "UG", "OHG", "AGB"],
  ...[
    "BVerfG",
    "BVerwG",
    "BAG",
    "BSG",
    "OLG",
    "LG",
    "VG",
    "OVG",
    "LAG",
    "LSG",
    "ArbG",
    "SG",
    "FG",
    "BayObLG",
  ],
]);

/** Ausgeschriebene Gesetzesnamen (nach "des"/"der") → Kürzel. */
const LAW_NAMES: [RegExp, string][] = [
  [/^Bürgerlichen Gesetzbuch(?:e|s|es)?$/, "BGB"],
  [/^Handelsgesetzbuch(?:e|s|es)?$/, "HGB"],
  [/^Einführungsgesetzes zum Bürgerlichen Gesetzbuche?$/, "EGBGB"],
  [/^Einführungsgesetzes zum Handelsgesetzbuche?$/, "EGHGB"],
  [/^Strafgesetzbuch(?:e|s|es)?$/, "StGB"],
  [/^Grundgesetzes$/, "GG"],
  [/^Aktiengesetzes$/, "AktG"],
  [/^Zivilprozessordnung$/, "ZPO"],
  [/^Strafprozessordnung$/, "StPO"],
];
/** Woran ein ausgeschriebener Gesetzesname endet; Verträge und Satzungen zählen mit, damit sie nicht als BGB gelten. */
const LAW_NAME_ENDING =
  /(?:gesetz|gesetzes|gesetzbuch|gesetzbuchs|gesetzbuches|gesetzbuche|ordnung|richtlinie|übereinkommens?|abkommens?|vertrag|vertrags|vertrages|satzung)$/i;

// ---------------------------------------------------------------------------------------------

class Scanner {
  readonly text: string;
  pos: number;

  constructor(text: string, pos: number) {
    this.text = text;
    this.pos = pos;
  }

  /** Position nach Leerraum, ohne weiterzurücken. */
  nextStart(): number {
    SPACE.lastIndex = this.pos;
    SPACE.exec(this.text);
    return SPACE.lastIndex;
  }

  /** Passt `re` nach optionalem Leerraum; bei Erfolg wird weitergerückt. */
  take(re: RegExp): RegExpExecArray | null {
    return this.takeAt(re, this.nextStart());
  }

  /** Passt `re` direkt an der aktuellen Position, ohne Leerraum davor. */
  takeHere(re: RegExp): RegExpExecArray | null {
    return this.takeAt(re, this.pos);
  }

  peek(re: RegExp): RegExpExecArray | null {
    const saved = this.pos;
    const match = this.take(re);
    this.pos = saved;
    return match;
  }

  private takeAt(re: RegExp, at: number): RegExpExecArray | null {
    re.lastIndex = at;
    const match = re.exec(this.text);
    if (match) this.pos = re.lastIndex;
    return match;
  }
}

/** Gemeinsame Eigenschaften der Normen einer Aufzählung. */
interface UnitContext {
  unit: Citation["unit"];
  /** Mit "§§" oder "Artt." eingeleitet. */
  plural: boolean;
  article?: string;
}

function parseGroup(text: string, start: number, options: ParseOptions): Citation[] | null {
  const s = new Scanner(text, start);
  const citations: Citation[] = [];
  /** Normen, denen noch kein Gesetz zugeordnet ist. */
  let withoutLaw: Citation[] = [];
  let end = start;
  let context: UnitContext | null = null;
  /** Bei "§ 114 Absatz 1 bis § 116": die Norm vor "bis". */
  let rangeFrom: Citation | undefined;

  for (;;) {
    const before = citations.length;
    const unit = parseUnit(s, citations, context);
    if (!unit) break;
    if (rangeFrom) rangeFrom.rangeTo = citations[before].section;
    rangeFrom = undefined;
    withoutLaw.push(...citations.slice(before));
    end = citations[citations.length - 1].end;

    const law = parseLaw(s, options);
    if (law) {
      withoutLaw = assignLaw(citations, withoutLaw, law.fields);
      end = law.end;
    }

    // Weitere Normen: "§ 280 I, § 241 II", "… i.V.m. § 241", ", der §§ 28", "§§ 823 II BGB, 263 StGB".
    const saved = s.pos;
    const range = s.take(RANGE);
    const separator = range ?? s.take(LIST_SEPARATOR);
    const chain = s.take(CHAIN);
    s.take(DETERMINER);
    context = null;
    if (s.peek(SECTION_SIGN) || s.peek(ARTICLE)) {
      if (range) rangeFrom = citations[citations.length - 1];
      continue;
    }
    if (law && unit.plural && (separator || chain) && continuesWithOtherLaw(s, unit, options)) {
      context = { unit: unit.unit, plural: true };
      continue;
    }
    if ((separator || chain) && s.take(NON_NORM_REFERENCE)) {
      const laterLaw = parseLaw(s, options);
      if (laterLaw) {
        for (const c of withoutLaw) Object.assign(c, laterLaw.fields);
        withoutLaw = [];
      }
    }
    s.pos = saved;
    break;
  }
  if (citations.length === 0) return null;

  let groupStart = start;
  const lawBefore = withoutLaw.length > 0 ? lawInFront(text, start) : null;
  if (lawBefore) {
    // Kommentarzitate wie "BeckOK BGB/Faust, BGB § 437 Rn. 10"
    for (const c of withoutLaw) Object.assign(c, { law: lawBefore.law, lawText: lawBefore.law });
    groupStart = lawBefore.start;
  } else if (
    options.defaultLaw &&
    !/(?:^|[^\p{L}])(?:dessen|deren)\s*$/u.test(text.slice(Math.max(0, start - 20), start))
  ) {
    for (const c of withoutLaw) if (c.unit === "§" && !c.article) c.law = options.defaultLaw;
  }
  for (const c of citations) {
    c.groupStart = groupStart;
    c.groupEnd = end;
  }
  return citations;
}

/**
 * Ordnet ein gefundenes Gesetz den wartenden Normen zu und gibt die zurück, die weiter warten.
 * Ein Gesetz hinter einem Artikel gilt nicht für Paragrafen davor:
 *   "§ 312d i.V.m. Artikel 246a § 1 des EGBGB" → § 312d bleibt ohne Gesetz (also Standardgesetz).
 */
function assignLaw(
  citations: Citation[],
  waiting: Citation[],
  fields: Partial<Citation>
): Citation[] {
  if (/^EG/.test(fields.law ?? "") || /Einführungsgesetz/.test(fields.lawText ?? "")) {
    // "Artikel 248 §§ 1 bis 12 … und §§ 14 bis 16 des Einführungsgesetzes": alle im selben Artikel.
    let article: string | undefined;
    for (const c of waiting) {
      if (c.article) article = c.article;
      else if (article && c.unit === "§") c.article = article;
    }
  }
  const kind = (c: Citation): string => (c.unit === "Art" || c.article ? "Art" : "§");
  const last = kind(citations[citations.length - 1]);
  let first = 0;
  while (first < waiting.length && kind(waiting[first]) !== last) first++;
  for (const c of waiting.slice(first)) Object.assign(c, fields);
  return waiting.slice(0, first);
}

/** Bei "§§ 823 II BGB, 263 StGB": Folgt auf die Zahl wirklich eine Norm mit eigenem Gesetz? */
function continuesWithOtherLaw(s: Scanner, unit: UnitContext, options: ParseOptions): boolean {
  const saved = s.pos;
  const probe: Citation[] = [];
  const found =
    parseUnit(s, probe, { unit: unit.unit, plural: true }) !== null &&
    parseLaw(s, options) !== null;
  s.pos = saved;
  return found;
}

/** Gesetzeskürzel direkt vor dem Zitat, z. B. "BGB § 437". */
function lawInFront(text: string, start: number): { law: string; start: number } | null {
  const match = /([A-ZÄÖÜ][\p{L}]*(?:-[\p{L}]+)*)[ \u00a0]+$/u.exec(
    text.slice(Math.max(0, start - 30), start)
  );
  if (!match || !isLawAbbreviation(match[1])) return null;
  const before = text.charAt(start - match[0].length - 1);
  if (/[\p{L}\d/-]/u.test(before)) return null;
  return { law: match[1], start: start - match[0].length };
}

/** "[Art. N] § N …", "Art. N …" oder (mit `context`) weitere Nummern derselben Aufzählung. */
function parseUnit(
  s: Scanner,
  citations: Citation[],
  context: UnitContext | null
): UnitContext | null {
  const saved = s.pos;
  const unitStart = s.nextStart();
  const fail = (): null => {
    s.pos = saved;
    return null;
  };

  let unit: UnitContext = context ?? { unit: "§", plural: false };
  let first: SectionNumber | null = null;
  if (!context) {
    const article = s.take(ARTICLE);
    if (article) {
      first = takeSectionNumber(s);
      if (!first) return fail();
      if (s.peek(SECTION_SIGN)) {
        unit = { unit: "§", plural: false, article: first.id };
        first = null;
      } else unit = { unit: "Art", plural: /^Art(?:t|ikeln)/.test(article[0]) };
    }
    if (unit.unit === "§") {
      const sign = s.take(SECTION_SIGN);
      if (!sign) return fail();
      unit.plural = sign[0].length > 1;
    }
  }

  const count = citations.length;
  let rangeFrom: Citation | undefined;
  for (;;) {
    const n = first ?? takeSectionNumber(s);
    first = null;
    if (!n) break;
    const citation: Citation = {
      unit: unit.unit,
      section: n.id,
      ...(unit.article ? { article: unit.article } : {}),
      pinpoints: [],
      start: citations.length > count || context ? n.start : unitStart,
      end: s.pos,
      groupStart: 0,
      groupEnd: 0,
    };
    if (rangeFrom) rangeFrom.rangeTo = citation.section;
    const following =
      n.following ?? (s.take(FOLLOWING)?.slice(1).find(Boolean) as "f" | "ff" | undefined);
    if (following) {
      citation.following = following;
      citation.end = s.pos;
    }
    parsePinpoints(s, citation, { plural: unit.plural, sectionNumber: parseInt(n.id, 10) });
    if (s.take(OLD_VERSION)) {
      citation.oldVersion = true;
      citation.end = s.pos;
    }
    citations.push(citation);

    // Nächste Norm ohne eigenes Paragrafenzeichen: "§§ 823, 826", "§§ 3 bis 6", "§ 280 I i.V.m. 241 II".
    const beforeSeparator = s.pos;
    const range = s.take(RANGE);
    const separator = range ?? s.take(LIST_SEPARATOR) ?? s.take(CHAIN);
    if (!separator || !peekSectionNumber(s)) {
      s.pos = beforeSeparator;
      break;
    }
    rangeFrom = range ? citation : undefined;
  }
  if (citations.length === count) return fail();
  return unit;
}

interface SectionNumber {
  id: string;
  following?: "f" | "ff";
  start: number;
}

/**
 * Normnummer mit Buchstabe: "433", "823a", "573 c". Angehängtes "ff." wird erkannt ("249ff."),
 * angehängtes "f." nur vor einem Gesetz ("343f. HGB"); sonst ist "f" der Buchstabe ("651f").
 */
function takeSectionNumber(s: Scanner): SectionNumber | null {
  const saved = s.pos;
  const digits = s.take(DIGITS);
  if (!digits) return null;
  const result: SectionNumber = { id: digits[0], start: digits.index };

  const afterDigits = s.pos;
  if (s.takeHere(/ff\.?(?![\p{L}\d])/uy)) result.following = "ff";
  else if (
    s.takeHere(/f\./y) &&
    s.peek(LAW_ABBREVIATION) &&
    isLawAbbreviation(s.peek(LAW_ABBREVIATION)![0])
  ) {
    result.following = "f";
  } else {
    s.pos = afterDigits;
    const letter =
      s.takeHere(/([a-z])(?![\p{L}\d])/uy) ?? s.takeHere(/[ \u00a0]([a-z])(?![\p{L}\d.)])/uy);
    if (letter) result.id += letter[1];
  }
  if (/[\p{L}\d]/u.test(s.text.charAt(s.pos)) && !result.following) {
    s.pos = saved;
    return null;
  }
  return result;
}

function peekSectionNumber(s: Scanner): boolean {
  const saved = s.pos;
  const found = takeSectionNumber(s) !== null;
  s.pos = saved;
  return found;
}

/**
 * Wann eine Zahl in einer Aufzählung zur nächsten Norm gehört statt zur aktuellen Ebene (siehe `isNextSection`).
 */
interface ListRule {
  plural: boolean;
  sectionNumber: number;
}

/** Liest "Abs. 1 S. 2 Nr. 3", "I 1", "Absatz 1 und 3", "1. Alt." usw. für eine Norm. */
function parsePinpoints(s: Scanner, citation: Citation, rule: ListRule): void {
  let current: Pinpoint | undefined;

  const add = (level: Level, values: string[]): void => {
    const depth = LEVELS.indexOf(level);
    const shallower = (p: Pinpoint | undefined): Pinpoint => {
      const copy: Pinpoint = {};
      for (const l of LEVELS.slice(0, depth)) if (p?.[l]) copy[l] = p[l];
      return copy;
    };
    // "Nr. 2 S. 1": der Satz gehört in die Nummer, nicht neben sie.
    const insideNumber =
      (level === "satz" || level === "halbsatz") &&
      !!(current?.nr || current?.buchstabe) &&
      !current?.[level];
    const deeperUsed = LEVELS.slice(depth).some((l) => current?.[l] !== undefined);
    if (!current || (deeperUsed && !insideNumber)) {
      current = shallower(current);
      citation.pinpoints.push(current);
    }
    if (insideNumber) current.withinNr = true;
    current[level] = values[0];
    for (const value of values.slice(1)) {
      current = { ...(insideNumber ? current : shallower(current)), [level]: value };
      citation.pinpoints.push(current);
    }
  };

  for (let first = true; ; first = false) {
    const beforePart = s.pos;
    // Ab dem zweiten Teil darf ein Trenner davorstehen: "I, III", "Abs. 1 und Abs. 3", "Abs. 3 i.V.m. Abs. 1".
    if (!first && !s.take(LIST_SEPARATOR) && !s.take(RANGE)) s.take(CHAIN);

    const romans = romanList(s);
    if (romans) {
      add("absatz", romans);
      citation.end = s.pos;
      // "§ 433 I 1": Zahl direkt hinter der römischen ist der Satz.
      const satz = numberList(s, rule, "satz");
      if (satz) {
        add("satz", satz.values);
        citation.end = satz.end;
      }
      continue;
    }

    const ordinal = s.take(ORDINAL_LEVEL);
    if (ordinal) {
      add(/^H/i.test(ordinal[2]) ? "halbsatz" : "alt", [ordinal[1]]);
      citation.end = s.pos;
      continue;
    }

    const keyword = LEVEL_KEYWORDS.find(([re]) => s.take(re));
    const list =
      keyword && (keyword[1] === "buchstabe" ? letterList(s) : numberList(s, rule, keyword[1]));
    if (!keyword || !list) {
      s.pos = beforePart;
      return;
    }
    add(keyword[1], list.values);
    citation.end = list.end;
  }
}

/** "I", "I, III", "I–III", "I und II" als Absatzzahlen. */
function romanList(s: Scanner): string[] | null {
  const first = takeRoman(s);
  if (first === null) return null;
  const values = [first];
  for (;;) {
    const saved = s.pos;
    const range = s.take(RANGE);
    if (!range) s.take(LIST_SEPARATOR);
    const next = takeRoman(s);
    if (next === null) {
      s.pos = saved;
      return values;
    }
    if (range) values.push(...between(values[values.length - 1], next));
    values.push(next);
  }
}

function takeRoman(s: Scanner): string | null {
  const saved = s.pos;
  const roman = s.take(ROMAN);
  if (roman && roman[1]) return String(romanToNumber(roman[1]));
  s.pos = saved;
  return null;
}

/**
 * "1", "1 und 3", "5 bis 8", "1, 5 bis 8, 11a"; bei Absätzen auch römisch ("Abs. II").
 * Hört vor einer Zahl auf, die schon die nächste Norm ist (siehe `isNextSection`).
 */
function numberList(
  s: Scanner,
  rule: ListRule,
  level: Level
): { values: string[]; end: number } | null {
  if (s.peek(ORDINAL_LEVEL)) return null;
  const takeValue = (): string | null => {
    const n = s.take(PIN_NUMBER);
    if (n) return n[1] + n[2];
    return level === "absatz" ? takeRoman(s) : null;
  };
  const first = takeValue();
  if (first === null) return null;
  const values = [first];
  let end = s.pos;
  for (;;) {
    const saved = s.pos;
    const range = s.take(RANGE);
    const separator = range ?? s.take(LIST_SEPARATOR);
    const value = separator && !s.peek(ORDINAL_LEVEL) ? takeValue() : null;
    if (value === null || (!range && isNextSection(s, value, rule, level))) {
      s.pos = saved;
      return { values, end };
    }
    if (range) values.push(...between(values[values.length - 1], value));
    values.push(value);
    end = s.pos;
  }
}

/**
 * Ist die eben gelesene Zahl die nächste Norm statt ein weiterer Absatz/Satz/Nr.?
 *   "§§ 280 Abs. 1, 241 Abs. 2" → ja: gleiche Ebene folgt (Abs.)
 *   "§§ 437 Nr. 2, 323 I"       → ja: römische Zahl folgt
 *   "§§ 437 Nr. 1, 439"         → ja: dreistellig (so hohe Absätze/Nummern gibt es nicht)
 *   "§§ 823 Abs. 1, 31 BGB"     → ja: bei "§§" direkt vor dem Gesetz
 *   "§ 1 Abs. 2, 3 S. 1"        → nein: tiefere Ebene folgt
 */
function isNextSection(s: Scanner, value: string, rule: ListRule, level: Level): boolean {
  const n = parseInt(value, 10);
  if (/^\d{3,}/.test(value)) return true;
  if (rule.plural && n >= rule.sectionNumber) return true;
  if (s.peek(FOLLOWING)) return true;
  const saved = s.pos;
  const roman = takeRoman(s) !== null;
  s.pos = saved;
  if (roman) return true;
  const keyword = LEVEL_KEYWORDS.find(([re]) => s.peek(re));
  if (keyword && LEVELS.indexOf(keyword[1]) <= LEVELS.indexOf(level)) return true;
  const law = s.peek(LAW_ABBREVIATION);
  return rule.plural && !!law && isLawAbbreviation(law[0]);
}

/** Zahlen strikt zwischen zwei Werten für "5 bis 8" → 6, 7 (höchstens 50, nur ohne Buchstaben). */
function between(from: string, to: string): string[] {
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return [];
  const a = parseInt(from, 10);
  const b = parseInt(to, 10);
  if (b <= a || b - a > 50) return [];
  const values: string[] = [];
  for (let v = a + 1; v < b; v++) values.push(String(v));
  return values;
}

/** "a", "a und b", "a bis g" (Bereiche werden aufgefüllt). */
function letterList(s: Scanner): { values: string[]; end: number } | null {
  const first = s.take(LETTER);
  if (!first) return null;
  const values = [first[1] ?? first[2]];
  let end = s.pos;
  for (;;) {
    const saved = s.pos;
    const range = s.take(RANGE);
    const letter = (range ?? s.take(LIST_SEPARATOR)) && s.take(LETTER);
    if (!letter) {
      s.pos = saved;
      return { values, end };
    }
    const value = letter[1] ?? letter[2];
    if (range) {
      const from = values[values.length - 1].charCodeAt(0);
      for (let c = from + 1; c < value.charCodeAt(0) && c - from <= 26; c++)
        values.push(String.fromCharCode(c));
    }
    values.push(value);
    end = s.pos;
  }
}

/** "BGB", "BGB a.F.", "des BGB", "des Aktiengesetzes", "dieses Gesetzes". */
function parseLaw(
  s: Scanner,
  options: ParseOptions
): { fields: Partial<Citation>; end: number } | null {
  const saved = s.pos;
  const result = (fields: Partial<Citation>): { fields: Partial<Citation>; end: number } => {
    if (s.take(OLD_VERSION)) fields.oldVersion = true;
    return { fields, end: s.pos };
  };

  const abbreviation = takeLawAbbreviation(s);
  if (abbreviation) return result({ law: abbreviation, lawText: abbreviation });

  const determiner = s.take(LAW_DETERMINER);
  if (!determiner) return null;
  const afterDeterminer = takeLawAbbreviation(s, false);
  if (afterDeterminer)
    return result({ law: afterDeterminer, lawText: `${determiner[0]} ${afterDeterminer}` });

  const words: string[] = [];
  for (let i = 0; i < 4; i++) {
    const next = takeLawNameWord(s);
    if (!next) break;
    words.push(next);
    if (!LAW_NAME_ENDING.test(next)) continue;

    // "Einführungsgesetzes zum Bürgerlichen Gesetzbuche"
    const beforeAddition = s.pos;
    const connector = s.take(LAW_NAME_CONNECTOR);
    if (connector) {
      const addition = [connector[0]];
      let complete = false;
      for (let j = 0; j < 2 && !complete; j++) {
        const w = takeLawNameWord(s);
        if (!w) break;
        addition.push(w);
        complete = LAW_NAME_ENDING.test(w);
      }
      if (complete) words.push(...addition);
      else s.pos = beforeAddition;
    }

    const name = words.join(" ");
    const law =
      determiner[0] === "dieses"
        ? options.defaultLaw
        : LAW_NAMES.find(([re]) => re.test(name))?.[1];
    return result({ ...(law ? { law } : {}), lawText: `${determiner[0]} ${name}` });
  }
  s.pos = saved;
  return null;
}

/** Kürzel wie "BGB"; bei "BGB-Kaufvertrag" (wenn `allowPrefix`) nur der Teil vor dem Bindestrich. */
function takeLawAbbreviation(s: Scanner, allowPrefix = true): string | null {
  const saved = s.pos;
  const match = s.take(LAW_ABBREVIATION);
  if (!match) return null;
  if (isLawAbbreviation(match[0])) return match[0];
  const prefix = match[0].split("-")[0];
  if (allowPrefix && prefix !== match[0] && isLawAbbreviation(prefix)) {
    s.pos = match.index + prefix.length;
    return prefix;
  }
  s.pos = saved;
  return null;
}

/**
 * Ein Wort eines ausgeschriebenen Gesetzesnamens. Großgeschrieben, oder ein Namensteil wie "eID-Karte-Gesetzes";
 * "Vormünder- und Betreuervergütungsgesetzes" und "Justizvergütungs- und -entschädigungsgesetzes" als ein Wort.
 */
function takeLawNameWord(s: Scanner): string | null {
  const saved = s.pos;
  const match = s.take(WORD);
  if (!match) return null;
  let w = match[0];
  if (w.endsWith("-")) {
    const back = s.pos;
    const conjunction = s.take(CONJUNCTION);
    const next = conjunction && s.take(WORD);
    if (next) w += ` ${conjunction[0]} ${next[0]}`;
    else s.pos = back;
  }
  const capitalised = /^[A-ZÄÖÜ]/.test(w);
  const namePart = /^\p{Ll}+[A-ZÄÖÜ]/u.test(w) && LAW_NAME_ENDING.test(w);
  if (capitalised || namePart) return w;
  s.pos = saved;
  return null;
}

/** Mindestens zwei Großbuchstaben und typische Endung (G, O, V, B), z. B. BGB, StGB, ZPO, InsO, DSGVO. */
function isLawAbbreviation(w: string): boolean {
  if (NOT_A_LAW.has(w) || /^[IVX]+$/.test(w) || w.length > 15) return false;
  if (KNOWN_LAWS.has(w)) return true;
  return w.replace(/[^A-ZÄÖÜ]/g, "").length >= 2 && /[GOVB]$/.test(w);
}

function romanToNumber(roman: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const value = values[roman[i]];
    const next = values[roman[i + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}
