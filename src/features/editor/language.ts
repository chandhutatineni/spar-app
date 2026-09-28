// Monaco language id for a file (EditorHost.language(for:) in the Mac app).

import { basename } from "../../lib/api";

const BY_EXT: Record<string, string> = {
  swift: "swift",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonl: "json",
  py: "python", rs: "rust", go: "go", rb: "ruby", java: "java",
  kt: "kotlin", kts: "kotlin",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", hpp: "cpp", cxx: "cpp", mm: "cpp", m: "cpp",
  cs: "csharp", php: "php",
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  md: "markdown", markdown: "markdown", mdc: "markdown",
  yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", cfg: "ini",
  xml: "xml", plist: "xml", svg: "xml",
  sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", graphql: "graphql", gql: "graphql",
  lua: "lua", dart: "dart", scala: "scala", r: "r",
};

export function languageFor(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return BY_EXT[ext] ?? "plaintext";
}

/** A readable name for the status bar ("typescript" → "TypeScript"). */
export function languageTitle(id: string): string {
  const names: Record<string, string> = {
    typescript: "TypeScript", javascript: "JavaScript", json: "JSON", python: "Python", rust: "Rust", go: "Go",
    ruby: "Ruby", java: "Java", kotlin: "Kotlin", c: "C", cpp: "C++", csharp: "C#", php: "PHP", html: "HTML",
    css: "CSS", scss: "SCSS", less: "Less", markdown: "Markdown", yaml: "YAML", ini: "INI", xml: "XML",
    shell: "Shell", sql: "SQL", graphql: "GraphQL", lua: "Lua", dart: "Dart", scala: "Scala", r: "R",
    swift: "Swift", dockerfile: "Dockerfile", makefile: "Makefile", plaintext: "Plain Text",
  };
  return names[id] ?? id;
}

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "tiff", "tif", "heic", "pdf", "zip", "gz", "tgz", "bz2",
  "xz", "7z", "rar", "jar", "war", "class", "o", "a", "so", "dylib", "dll", "exe", "bin", "wasm", "woff", "woff2",
  "ttf", "otf", "eot", "mp3", "mp4", "mov", "avi", "mkv", "wav", "flac", "ogg", "webm", "sqlite", "db", "pyc",
  "docx", "xlsx", "pptx", "doc", "xls", "ppt", "psd", "sketch", "key", "numbers", "pages", "dmg", "pkg",
]);

/** Files that are not text by their extension (cheap check before reading). */
export function isBinaryPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 && BINARY_EXT.has(name.slice(dot + 1));
}

/** Text read from disk looks binary: NUL bytes or many replacement characters. */
export function looksBinary(text: string): boolean {
  const head = text.slice(0, 8000);
  if (head.includes("\u0000")) return true;
  let bad = 0;
  for (const ch of head) if (ch === "�") bad++;
  return head.length > 0 && bad / head.length > 0.1;
}
