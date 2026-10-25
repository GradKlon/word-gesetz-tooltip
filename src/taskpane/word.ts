/*
 * Anbindung an Word: liest den Absatz unter dem Cursor und meldet Cursorbewegungen.
 */

/* global Office, Word */

import type { CursorText } from "./panel";

/** Absatztext und Cursorposition darin; bei einer Markierung zählt ihr Anfang. Wirft, wenn Word nicht liefert. */
export async function readCursor(): Promise<CursorText> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const paragraph = selection.paragraphs.getFirst();
    // Text vom Absatzanfang bis zum Cursor; seine Länge ist die Cursorposition im Absatz.
    const before = paragraph
      .getRange(Word.RangeLocation.start)
      .expandTo(selection.getRange(Word.RangeLocation.start));
    paragraph.load("text");
    before.load("text");
    await context.sync();
    return { text: paragraph.text, offset: before.text.length };
  });
}

/**
 * Ruft `listener` nach jeder Cursorbewegung auf, gebündelt mit kurzer Pause.
 * `onError` erfährt, wenn Word das Ereignis nicht liefern kann (z. B. fehlende Berechtigung).
 */
export function onCursorMoved(
  listener: () => void,
  onError: (message: string) => void,
  delayMs = 150
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  Office.context.document.addHandlerAsync(
    Office.EventType.DocumentSelectionChanged,
    () => {
      clearTimeout(timer);
      timer = setTimeout(listener, delayMs);
    },
    (result) => {
      if (result.status === Office.AsyncResultStatus.Failed) onError(result.error.message);
    }
  );
}
