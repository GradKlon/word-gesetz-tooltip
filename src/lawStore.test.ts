import { describe, expect, it, vi } from "vitest";
import { findCitations } from "./citationParser";
import { LawStore, normUrl, sectionPath } from "./lawStore";
import { loadLawFromDisk } from "./testData";

const cite = (text: string) => findCitations(text)[0];

describe("LawStore", () => {
  it("findet Normen in BGB und HGB", async () => {
    const store = new LawStore(loadLawFromDisk);
    const bgb = await store.lookup(cite("§ 433 Abs. 1 BGB"));
    expect(bgb.kind === "norm" && bgb.norm.title).toBe(
      "Vertragstypische Pflichten beim Kaufvertrag"
    );
    const hgb = await store.lookup(cite("§ 377 HGB"));
    expect(hgb.kind === "norm" && hgb.norm.label).toBe("§ 377");
  });

  it("unterscheidet fehlende Norm, fremdes Gesetz und fehlende Angabe", async () => {
    const store = new LawStore(loadLawFromDisk);
    expect((await store.lookup(cite("§ 9999 BGB"))).kind).toBe("missing");
    expect(await store.lookup(cite("§ 263 StGB"))).toEqual({
      kind: "unavailable",
      law: "StGB",
      lawText: "StGB",
    });
    expect(await store.lookup(cite("Art. 1 GG"))).toMatchObject({ kind: "unavailable", law: "GG" });
    expect(await store.lookup(cite("Art. 229 § 5 EGBGB"))).toMatchObject({
      kind: "unavailable",
      law: "EGBGB",
    });
    expect(await store.lookup(cite("§ 185a des Gesetzes über das Verfahren"))).toEqual({
      kind: "unavailable",
      lawText: "des Gesetzes",
    });
    expect(await store.lookup(cite("siehe § 433"))).toEqual({ kind: "no-law" });
  });

  it("lädt jedes Gesetz nur einmal, nach einem Fehler aber erneut", async () => {
    const load = vi.fn(loadLawFromDisk);
    const store = new LawStore(load);
    await Promise.all([store.law("BGB"), store.law("BGB")]);
    expect(load).toHaveBeenCalledTimes(1);

    let fail = true;
    const flaky = new LawStore(async (slug) => {
      if (fail) throw new Error("offline");
      return loadLawFromDisk(slug);
    });
    await expect(flaky.law("HGB")).rejects.toThrow("offline");
    fail = false;
    await expect(flaky.law("HGB")).resolves.toMatchObject({ file: { abbr: "HGB" } });
  });

  it("Gliederung und Link zur Quelle", async () => {
    const bgb = await new LawStore(loadLawFromDisk).law("BGB");
    const norm = bgb.byId.get("433")!;
    expect(sectionPath(bgb.file, norm).map((s) => s.bez)).toEqual([
      "Buch 2",
      "Abschnitt 8",
      "Titel 1",
      "Untertitel 1",
    ]);
    expect(normUrl(bgb.file, norm)).toBe("https://www.gesetze-im-internet.de/bgb/__433.html");
    expect(normUrl(bgb.file, bgb.byId.get("4")!)).toBe(
      "https://www.gesetze-im-internet.de/bgb/___3_bis_6.html"
    );
  });
});
