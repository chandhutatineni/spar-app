import { describe, expect, it } from "vitest";
import { lineDiff } from "./linediff";

const fmt = (b: string, a: string) => lineDiff(b, a).map((l) => l.kind + l.text);

describe("lineDiff", () => {
  it("marks a changed line as removal then insertion", () => {
    expect(fmt("x = 1\nf()\n", "x = 2\nf()\n")).toEqual(["-x = 1", "+x = 2", " f()", " "]);
  });
  it("handles pure insertions and deletions", () => {
    expect(fmt("", "a\nb")).toEqual(["+a", "+b"]);
    expect(fmt("a\nb", "")).toEqual(["-a", "-b"]);
    expect(fmt("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
    expect(fmt("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
  });
  it("keeps identical text unchanged", () => {
    expect(fmt("a\nb", "a\nb")).toEqual([" a", " b"]);
  });
  it("is minimal on mixed edits", () => {
    const out = lineDiff("a\nb\nc\nd\ne", "a\nx\nc\ne\nf");
    expect(out.filter((l) => l.kind !== " ").length).toBe(4);
    expect(out.filter((l) => l.kind !== "-").map((l) => l.text)).toEqual(["a", "x", "c", "e", "f"]);
    expect(out.filter((l) => l.kind !== "+").map((l) => l.text)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("lineDiff at scale", () => {
  it("falls back gracefully on very different large inputs", () => {
    const a = Array.from({ length: 8000 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 8000 }, (_, i) => `b${i}`).join("\n");
    const out = lineDiff(a, b);
    expect(out.length).toBe(16000);
    expect(out[0].kind).toBe("-");
  });
  it("keeps a common prefix and suffix around the change", () => {
    const base = Array.from({ length: 5000 }, (_, i) => `l${i}`);
    const after = [...base.slice(0, 2500), "new", ...base.slice(2500)];
    const out = lineDiff(base.join("\n"), after.join("\n"));
    expect(out.filter((l) => l.kind !== " ")).toEqual([{ kind: "+", text: "new" }]);
  });
});
