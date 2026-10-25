/*
 * Browser-Demo ohne Word: ein Textfeld spielt das Dokument, der Seitenbereich reagiert auf den Cursor.
 * Läuft automatisch, wenn die Seite außerhalb von Word geöffnet wird.
 */

import type { CitationPanel, CursorText } from "./panel";

const SAMPLE = `A. Anspruch des K gegen V auf Übergabe und Übereignung gem. § 433 Abs. 1 S. 1 BGB

K könnte gegen V einen Anspruch aus § 433 I 1 BGB haben. Dazu müsste ein wirksamer Kaufvertrag vorliegen. Ein Vertrag kommt durch zwei übereinstimmende Willenserklärungen zustande, §§ 145 ff. BGB.

B. Rücktritt und Schadensersatz

Ist die Sache mangelhaft, kann K gem. §§ 437 Nr. 2, 323 I BGB zurücktreten oder nach §§ 437 Nr. 3, 280 I, III, 281 I 1 BGB Schadensersatz statt der Leistung verlangen. Daneben kommt ein Anspruch aus §§ 280 Abs. 1, 241 Abs. 2 BGB in Betracht.

C. Handelskauf

Sind beide Parteien Kaufleute (§ 1 Abs. 1 HGB), muss K die Ware nach § 377 Abs. 1 HGB unverzüglich untersuchen und Mängel rügen. Unterlässt er die Rüge, gilt die Ware gem. § 377 II als genehmigt.

D. Weitere Beispiele

§ 823 II BGB i.V.m. § 263 StGB · § 90a S. 1 BGB · §§ 3 bis 6 BGB · § 651 BGB · § 476 BGB a.F. · Art. 2 Abs. 1 GG`;

/** Zeigt das Demo-Dokument an und verbindet es mit dem Seitenbereich. */
export function startDemo(panel: CitationPanel, container: HTMLElement): void {
  document.body.classList.add("demo");
  container.hidden = false;
  const editor = container.querySelector("textarea");
  if (!editor) return;
  editor.value = SAMPLE;
  const update = (): void =>
    void panel.showCursor(paragraphAt(editor.value, editor.selectionStart));
  for (const event of ["click", "keyup", "input", "select", "focus"])
    editor.addEventListener(event, update);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === editor) update();
  });
  // Startet mit dem Cursor im ersten Zitat, damit gleich etwas zu sehen ist.
  editor.setSelectionRange(SAMPLE.indexOf("§ 433") + 2, SAMPLE.indexOf("§ 433") + 2);
  update();
}

/** Wie in Word: nur der Absatz (Zeile) unter dem Cursor und die Position darin. */
export function paragraphAt(text: string, offset: number): CursorText {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return { text: text.slice(start, end === -1 ? undefined : end), offset: offset - start };
}
