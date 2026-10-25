/*
 * Schreibt ein erkanntes Zitat einheitlich aus, z. B. "§ 433 Abs. 1 S. 2 BGB".
 */

import type { Citation, Pinpoint } from "./citationParser";

type Part = Exclude<keyof Pinpoint, "withinNr">;

const LABELS: Record<Part, string> = {
  absatz: "Abs.",
  unterabsatz: "UAbs.",
  satz: "S.",
  halbsatz: "Hs.",
  nr: "Nr.",
  buchstabe: "lit.",
  alt: "Alt.",
};
const ORDER: Part[] = ["absatz", "unterabsatz", "satz", "halbsatz", "nr", "buchstabe", "alt"];
/** "§ 569 Abs. 3 Nr. 2 S. 1": Satz innerhalb der Nummer. */
const ORDER_WITHIN_NR: Part[] = [
  "absatz",
  "unterabsatz",
  "nr",
  "buchstabe",
  "satz",
  "halbsatz",
  "alt",
];

/** "Abs. 1 S. 2" für eine genaue Stelle. */
export function formatPinpoint(p: Pinpoint): string {
  return (p.withinNr ? ORDER_WITHIN_NR : ORDER)
    .filter((part) => p[part] !== undefined)
    .map((part) => `${LABELS[part]} ${p[part]}`)
    .join(" ");
}

/** "§ 433 Abs. 1 S. 1, Abs. 2 BGB", "Art. 229 § 5 EGBGB", "§§ 1 bis 3 HGB", "§ 343 f. HGB". */
export function formatCitation(c: Citation): string {
  const sign = c.rangeTo ? "§§" : "§";
  const head = c.unit === "Art" ? "Art." : c.article ? `Art. ${c.article} ${sign}` : sign;
  let text = `${head} ${c.section}`;
  if (c.rangeTo) text += ` bis ${c.rangeTo}`;
  if (c.following) text += ` ${c.following}.`;
  const pinpoints = c.pinpoints.map(formatPinpoint).filter(Boolean);
  if (pinpoints.length > 0) text += ` ${pinpoints.join(", ")}`;
  const law = c.law ?? c.lawText;
  if (law) text += ` ${law}`;
  if (c.oldVersion) text += " a.F.";
  return text;
}
