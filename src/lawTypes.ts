/*
 * Datenformat der Gesetzesdateien in src/data/*.json.
 * Erzeugt von scripts/build-laws.mts, gelesen vom Task-Pane.
 */

/** Ein Gesetz, z. B. das BGB. */
export interface LawFile {
  /** Amtliche Abkürzung, z. B. "BGB". */
  abbr: string;
  /** Langtitel, z. B. "Bürgerliches Gesetzbuch". */
  title: string;
  /** Standangaben, z. B. "zuletzt geändert durch Art. 6 G v. 23.7.2026 I Nr. 226". */
  stand: string[];
  /** Erstellungszeitpunkt der XML-Quelle (JJJJMMTThhmmss). */
  builddate: string;
  /** Startseite des Gesetzes auf gesetze-im-internet.de. */
  source: string;
  /** Text vor der ersten Norm, im BGB die Liste der umgesetzten EU-Richtlinien (auf sie verweisen Fußnoten wie die zu § 14). */
  preamble?: Paragraph[];
  /** Gliederung (Buch, Abschnitt, Titel …), über `parent` verkettet. */
  sections: Section[];
  /** Alle Normen in Gesetzesreihenfolge. */
  norms: Norm[];
}

export interface Section {
  /** z. B. "Buch 2" oder "Abschnitt 8". */
  bez: string;
  /** z. B. "Recht der Schuldverhältnisse". */
  title: string;
  /** Index der übergeordneten Gliederungsebene in `sections`. */
  parent?: number;
  /** Amtliche Fußnoten zur Gliederungsebene, z. B. welche Richtlinie ein Titel umsetzt. */
  footnotes?: string[];
}

export interface Norm {
  /** Schlüssel ohne Paragrafenzeichen, z. B. "433" oder "90a". */
  id: string;
  /** Anzeigename, z. B. "§ 433". */
  label: string;
  /** Nur bei zusammengefasst aufgehobenen Normen: der ganze Bereich, z. B. "§§ 3 bis 6". */
  range?: string;
  /**
   * Amtliche Überschrift (im HGB oft nicht vorhanden). Zweizeilige Überschriften enthalten "\n".
   * Bei weggefallenen Normen nur gesetzt, wenn sie einen Hinweis enthält, z. B. "(jetzt § 650)".
   */
  title?: string;
  /** Index der innersten Gliederungsebene in `sections`. */
  section?: number;
  /** Norm ist aufgehoben ("(weggefallen)"). */
  repealed?: true;
  paragraphs: Paragraph[];
  /** Amtliche Fußnoten, z. B. "Amtlicher Hinweis: …". Aufzählungen darin stehen als "1. …" je in einer Zeile. */
  footnotes?: string[];
}

/** Ein Absatz. `num` ist die Absatznummer ohne Klammern, z. B. "1" oder "2a". */
export interface Paragraph {
  num?: string;
  content: Inline[];
}

/** Fließtext (Zeilenumbrüche als "\n") oder eine Aufzählung. */
export type Inline = string | List;

export interface List {
  /** Art der Nummerierung laut Quelle, z. B. "arabic" (1., 2.) oder "alpha" (a), b)). */
  list: string;
  items: ListItem[];
}

export interface ListItem {
  /** z. B. "1.", "1a." oder "b)". */
  label: string;
  content: Inline[];
}
