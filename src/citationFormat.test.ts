import { describe, expect, it } from "vitest";
import { formatCitation } from "./citationFormat";
import { findCitations } from "./citationParser";

const format = (text: string, index = 0) => formatCitation(findCitations(text)[index]);

describe("formatCitation", () => {
  it("vereinheitlicht Schreibweisen", () => {
    expect(format("§ 433 I 1 BGB")).toBe("§ 433 Abs. 1 S. 1 BGB");
    expect(format("§ 433 Absatz 1 Satz 1, Absatz 2 BGB")).toBe("§ 433 Abs. 1 S. 1, Abs. 2 BGB");
    expect(format("§ 812 Abs. 1 S. 1 1. Alt. BGB")).toBe("§ 812 Abs. 1 S. 1 Alt. 1 BGB");
    expect(format("§ 81 Abs. 1 Nr. 1 Buchst. a BGB")).toBe("§ 81 Abs. 1 Nr. 1 lit. a BGB");
  });

  it("Satz innerhalb einer Nummer bleibt hinter der Nummer", () => {
    expect(format("§ 569 Abs. 3 Nr. 2 S. 1 BGB")).toBe("§ 569 Abs. 3 Nr. 2 S. 1 BGB");
    expect(format("§ 434 Abs. 1 S. 2 Nr. 1 BGB")).toBe("§ 434 Abs. 1 S. 2 Nr. 1 BGB");
  });

  it("Bereiche, ff., alte Fassung, Artikel und ausgeschriebene Gesetze", () => {
    expect(format("§§ 3 bis 6 BGB")).toBe("§§ 3 bis 6 BGB");
    expect(format("§§ 1 ff. HGB")).toBe("§ 1 ff. HGB");
    expect(format("§ 476 BGB a.F.")).toBe("§ 476 BGB a.F.");
    expect(format("Art. 1 Abs. 1 GG")).toBe("Art. 1 Abs. 1 GG");
    expect(format("Art. 229 § 5 S. 1 EGBGB")).toBe("Art. 229 § 5 S. 1 EGBGB");
    expect(format("§ 76 des Aktiengesetzes")).toBe("§ 76 AktG");
    expect(format("§ 185a des Gesetzes über das Verfahren")).toBe("§ 185a des Gesetzes");
    expect(format("siehe § 433")).toBe("§ 433");
  });
});
