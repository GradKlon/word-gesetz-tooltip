/*
 * Einstieg des Seitenbereichs: in Word mit dem Dokument verbunden, im Browser mit dem Demo-Textfeld.
 */

/* global document, Office */

import { LawStore } from "../lawStore";
import { startDemo } from "./demo";
import { CitationPanel } from "./panel";
import { onCursorMoved, readCursor } from "./word";

const panel = new CitationPanel(document.getElementById("panel")!, new LawStore());
const demo = document.getElementById("demo")!;

async function startWord(): Promise<void> {
  demo.remove();
  // Lesevorgänge können sich überholen; es zählt nur der zuletzt begonnene.
  let latest = 0;
  const update = async (): Promise<void> => {
    const mine = ++latest;
    try {
      const cursor = await readCursor();
      if (mine === latest) await panel.showCursor(cursor);
    } catch (error) {
      if (mine === latest)
        panel.showProblem(
          `Das Word-Dokument konnte nicht gelesen werden: ${(error as Error).message}`,
          "Problem mit Word"
        );
    }
  };
  onCursorMoved(
    () => void update(),
    (message) =>
      panel.showProblem(
        `Cursorbewegungen in Word können nicht verfolgt werden: ${message}`,
        "Problem mit Word"
      )
  );
  await update();
}

if (typeof Office === "undefined") {
  // office.js nicht geladen (z. B. offline): trotzdem als Demo nutzbar.
  startDemo(panel, demo);
} else {
  Office.onReady((info) => {
    if (info.host === Office.HostType.Word) void startWord();
    else startDemo(panel, demo);
  });
}
