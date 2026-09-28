import { describe, expect, it } from "vitest";
import { parseGitHub } from "./api";

describe("parseGitHub", () => {
  it("reads HTTPS and SSH remotes", () => {
    expect(parseGitHub("https://github.com/octo/hello.git")).toEqual({ owner: "octo", repo: "hello" });
    expect(parseGitHub("https://github.com/octo/hello")).toEqual({ owner: "octo", repo: "hello" });
    expect(parseGitHub("git@github.com:octo/hello.git")).toEqual({ owner: "octo", repo: "hello" });
    expect(parseGitHub("https://github.com/octo/hello/")).toEqual({ owner: "octo", repo: "hello" });
  });
  it("ignores other hosts and paths", () => {
    expect(parseGitHub("/tmp/remote.git")).toBeNull();
    expect(parseGitHub("https://gitlab.com/octo/hello.git")).toBeNull();
    expect(parseGitHub(null)).toBeNull();
  });
});
