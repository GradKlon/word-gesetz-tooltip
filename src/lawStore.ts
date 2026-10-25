/*
 * Lädt die Gesetzesdateien (src/data/*.json, im Build unter data/) bei Bedarf und findet Normen zu Zitaten.
 */

import type { Citation } from "./citationParser";
import type { LawFile, Norm, Section } from "./lawTypes";

/** Gesetze, deren Text das Add-in mitbringt: Kürzel → Dateiname. */
export const AVAILABLE_LAWS: Record<string, string> = {
  BGB: "bgb",
  HGB: "hgb",
};

export interface LoadedLaw {
  file: LawFile;
  byId: Map<string, Norm>;
}

/** Ergebnis der Suche nach der Norm zu einem Zitat. */
export type Lookup =
  | { kind: "norm"; law: LoadedLaw; norm: Norm }
  /** Gesetz ist bekannt, aber die Norm gibt es darin nicht. */
  | { kind: "missing"; law: LoadedLaw }
  /** Gesetz ist nicht enthalten (z. B. StGB) oder unbekannt ("des Gesetzes über …"). */
  | { kind: "unavailable"; law?: string; lawText?: string }
  /** Kein Gesetz angegeben und keins aus dem Zusammenhang ableitbar. */
  | { kind: "no-law" };

export type LawLoader = (slug: string) => Promise<LawFile>;

/** Lädt eine Gesetzesdatei relativ zur Seite (data/bgb.json). */
export async function fetchLaw(slug: string): Promise<LawFile> {
  const response = await fetch(`data/${slug}.json`);
  if (!response.ok)
    throw new Error(`Gesetzesdatei ${slug}.json nicht geladen (HTTP ${response.status})`);
  return (await response.json()) as LawFile;
}

export class LawStore {
  private readonly load: LawLoader;
  private readonly cache = new Map<string, Promise<LoadedLaw>>();

  constructor(load: LawLoader = fetchLaw) {
    this.load = load;
  }

  isAvailable(abbr: string | undefined): abbr is string {
    return abbr !== undefined && abbr in AVAILABLE_LAWS;
  }

  /** Lädt ein Gesetz einmal und hält es danach im Speicher. */
  law(abbr: string): Promise<LoadedLaw> {
    let loaded = this.cache.get(abbr);
    if (!loaded) {
      loaded = this.load(AVAILABLE_LAWS[abbr]).then((file) => ({
        file,
        byId: new Map(file.norms.map((n) => [n.id, n])),
      }));
      // Bei Fehlern nicht den fehlgeschlagenen Versuch merken, damit ein späterer erneut lädt.
      loaded.catch(() => this.cache.delete(abbr));
      this.cache.set(abbr, loaded);
    }
    return loaded;
  }

  /** Sucht die Norm zu einem Zitat. Artikel (Art. …) gibt es in BGB und HGB nicht. */
  async lookup(citation: Citation): Promise<Lookup> {
    if (!citation.law)
      return citation.lawText
        ? { kind: "unavailable", lawText: citation.lawText }
        : { kind: "no-law" };
    if (!this.isAvailable(citation.law) || citation.unit === "Art" || citation.article) {
      return { kind: "unavailable", law: citation.law, lawText: citation.lawText };
    }
    const law = await this.law(citation.law);
    const norm = law.byId.get(citation.section);
    return norm ? { kind: "norm", law, norm } : { kind: "missing", law };
  }
}

/** Gliederung über der Norm, von außen nach innen (z. B. Buch 2 › Abschnitt 8 › Titel 1). */
export function sectionPath(law: LawFile, norm: Norm): Section[] {
  const path: Section[] = [];
  for (let i = norm.section; i !== undefined; i = law.sections[i].parent)
    path.unshift(law.sections[i]);
  return path;
}

/** Seite der Norm auf gesetze-im-internet.de; zusammengefasste Bereiche haben eine gemeinsame Seite. */
export function normUrl(law: LawFile, norm: Norm): string {
  if (norm.range)
    return `${law.source}___${norm.range.replace(/^§§\s*/, "").replace(/[ .]/g, "_")}.html`;
  return `${law.source}__${norm.id}.html`;
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

/** Seite einer nicht enthaltenen Norm auf gesetze-im-internet.de, soweit sich die Adresse ableiten lässt. */
export function externalUrl(law: string, citation: Citation): string | undefined {
  if (EU_LAWS.has(law) || citation.article || !/^[\p{L}-]+$/u.test(law)) return undefined;
  const slug = LAW_SLUGS[law] ?? law.toLowerCase();
  const page = citation.unit === "Art" ? `art_${citation.section}` : `__${citation.section}`;
  return `https://www.gesetze-im-internet.de/${slug}/${page}.html`;
}
