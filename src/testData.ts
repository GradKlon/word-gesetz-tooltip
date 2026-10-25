/* Hilfen für Tests: Gesetzesdateien direkt von der Festplatte statt per fetch laden. */

import { readFileSync } from "node:fs";
import type { LawFile } from "./lawTypes";

export async function loadLawFromDisk(slug: string): Promise<LawFile> {
  return JSON.parse(readFileSync(`src/data/${slug}.json`, "utf8")) as LawFile;
}
