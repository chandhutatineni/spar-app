import { describe, expect, it } from "vitest";
import { matchGlob, parseRule, ruleApplies, ruleSlug, withFrontMatter } from "./rules";

describe("rules", () => {
  it("matches globs like the Mac app", () => {
    expect(matchGlob("*.ts", "src/a.ts")).toBe(true);
    expect(matchGlob("src/*.ts", "src/a.ts")).toBe(true);
    expect(matchGlob("src/*.ts", "src/x/a.ts")).toBe(false);
    expect(matchGlob("src/**/*.ts", "src/x/y/a.ts")).toBe(true);
    expect(matchGlob("src/**/*.ts", "src/a.ts")).toBe(true);
    expect(matchGlob("a?.md", "ab.md")).toBe(true);
    expect(matchGlob("*.test.ts", "lib/x.test.ts")).toBe(true);
    expect(matchGlob("*.ts", "a.tsx")).toBe(false);
  });
  it("parses and rewrites front matter", () => {
    const r = parseRule("/p/spar/rules/api.md", "---\ndescription: \"API errors\"\nglobs: [src/api/**/*.ts, '*.test.ts']\nalwaysApply: false\n---\n\n# Body");
    expect(r).toEqual({ path: "/p/spar/rules/api.md", description: "API errors", globs: ["src/api/**/*.ts", "*.test.ts"], alwaysApply: false });
    expect(ruleApplies(r, ["src/api/x/y.ts"])).toBe(true);
    expect(ruleApplies(r, ["README.md"])).toBe(false);
    const t = withFrontMatter({ ...r, alwaysApply: true }, "---\ndescription: x\n---\n\n# Body");
    expect(t).toBe("---\ndescription: API errors\nglobs: src/api/**/*.ts, *.test.ts\nalwaysApply: true\n---\n\n# Body");
    expect(parseRule("/x.md", "no front matter").alwaysApply).toBe(false);
  });
  it("slugs rule names", () => {
    expect(ruleSlug("API error handling!")).toBe("api-error-handling");
    expect(ruleSlug("  ")).toBe("");
  });
});
