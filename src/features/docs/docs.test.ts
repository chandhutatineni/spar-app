import { beforeAll, describe, expect, it } from "vitest";
import { parseBlocks } from "./markdownBlocks";

// The modules touch `window` (preferences) when loaded; a stub is enough for these pure functions.
let detectEngine: typeof import("./engines").detectEngine;
let template: typeof import("./engines").template;
let slugify: typeof import("./engines").slugify;
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { origin: "http://x" } };
  g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  g.navigator ??= { platform: "Mac" };
  g.location ??= { origin: "http://x", hash: "" };
  ({ detectEngine, template, slugify } = await import("./engines"));
});

describe("docs", () => {
  it("detects diagram engines", () => {
    expect(detectEngine("a/b.drawio")).toBe("drawio");
    expect(detectEngine("x.drawio.svg")).toBe("drawio");
    expect(detectEngine("x.d2")).toBe("d2");
    expect(detectEngine("x.mmd")).toBe("mermaid");
    expect(detectEngine("x.wsd")).toBe("c4PlantUML");
    expect(detectEngine("x.py", "from diagrams import Diagram")).toBe("pythonDiagrams");
    expect(detectEngine("x.py", "print(1)")).toBeNull();
    expect(detectEngine("x.md")).toBeNull();
  });
  it("slugs names like the Mac app", () => {
    expect(slugify("  My Cool Diagram! ")).toBe("my_cool_diagram");
  });
  it("templates carry the name", () => {
    expect(template("c4PlantUML", "Shop")).toContain("title Shop");
  });
  it("parses markdown blocks", () => {
    const b = parseBlocks("---\na: 1\n---\n# Title\n\n- [x] done\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph\n```");
    expect(b.map((x) => x.kind)).toEqual(["heading", "list", "table", "code"]);
    expect((b[1] as any).items[0].checked).toBe(true);
    expect((b[2] as any).rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});
