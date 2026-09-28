import { describe, expect, it } from "vitest";
import { buildSearchArgs, parseGrep } from "./SearchView";
import { rankFiles } from "./Palette";
import { languageFor, looksBinary } from "./language";

describe("search", () => {
  it("builds git grep and grep arguments like the Mac app", () => {
    expect(buildSearchArgs("foo", { isRepo: true, matchCase: false, wholeWord: true, regex: false, include: "*.ts, src/" }))
      .toEqual(["git", ["grep", "-n", "-I", "--no-color", "--untracked", "-i", "-w", "-F", "-e", "foo", "--", "*.ts", "src/"]]);
    expect(buildSearchArgs("a.*b", { isRepo: false, matchCase: true, wholeWord: false, regex: true, include: "*.py" }))
      .toEqual(["grep", ["-rnI", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=.build", "--exclude-dir=dist", "-E", "-e", "a.*b", "--include=*.py", "."]]);
  });
  it("groups grep output by file", () => {
    const r = parseGrep("./src/a.ts:3:const x = 1: y\nsrc/a.ts:9:x\nREADME.md:1:# x\nnot a hit\n");
    expect(r.total).toBe(3);
    expect(r.groups).toEqual([
      { file: "src/a.ts", hits: [{ line: 3, text: "const x = 1: y" }, { line: 9, text: "x" }] },
      { file: "README.md", hits: [{ line: 1, text: "# x" }] },
    ]);
  });
});

describe("quick open", () => {
  it("ranks exact names, prefixes, contains, paths, then subsequences", () => {
    const all = ["src/xindex.ts", "src/index.ts", "lib/indexer.ts", "index/readme.md", "src/i_n_d_e_x.ts"];
    expect(rankFiles(all, "index.ts")).toEqual(["src/index.ts", "src/xindex.ts", "lib/indexer.ts", "src/i_n_d_e_x.ts"]);
    expect(rankFiles(all, "index").slice(0, 2)).toEqual(["src/index.ts", "lib/indexer.ts"]);
  });
});

describe("languages", () => {
  it("maps files to Monaco languages", () => {
    expect(languageFor("/a/b.tsx")).toBe("typescript");
    expect(languageFor("/a/Dockerfile")).toBe("dockerfile");
    expect(languageFor("/a/x.unknown")).toBe("plaintext");
    expect(looksBinary("abc\u0000def")).toBe(true);
    expect(looksBinary("plain text")).toBe(false);
  });
});
