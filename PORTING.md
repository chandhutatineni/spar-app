# Porting the Mac app to SPAR — contract for every feature

Goal: on macOS, SPAR (this Tauri app) has **every** feature of the Swift Mac app at
`/Users/chandhu/aegis/spar-app-old/Sources/SPAR`. The Swift source is the spec: port behaviour
faithfully (texts, states, edge cases, preferences, shortcuts), not loosely. Where Swift
uses macOS-only APIs, use the cross-platform equivalent (Windows runs tools inside WSL; the
backend's `exec`/`platform` already handle that — never shell out to macOS-only tools
without a fallback).

## Architecture (read these first)
- `src-tauri/src/registry.rs` — every backend command, by name. A Rust module adds commands
  in its `register(r)`; handlers take/return `serde_json::Value`, are blocking, run off the UI
  thread. Long-running work: spawn a thread and report with `events::emit(topic, payload)`.
- `src-tauri/src/events.rs` — backend → UI events (Tauri events + dev-bridge log).
- `src-tauri/src/exec.rs` — run tools (`exec_run`, `exec_spawn`/`exec_kill` with `proc:*`
  events), login-shell PATH, env incl. GitHub tokens from secrets. In Rust use
  `crate::exec::run(...)` / `crate::exec::command(...)`.
- `src-tauri/src/fsx.rs` (files + `fs:change` watch), `secrets.rs` (secrets + human token),
  `engine.rs` (engine processes, `engine_http`, session stream → `engine:event`),
  `appx.rs` (menu → `menu` events, windows, open/reveal, run in Terminal), `setup.rs`.
- UI: `src/lib/backend.ts` (`call`, `listen`), `src/lib/api.ts` (typed fs/exec/secrets/app/
  spar wrappers, dialogs), `src/lib/prefs.ts` (`usePref` — use the Mac app's @AppStorage /
  UserDefaults key names), `src/lib/commands.ts` (`useCommand(id, …)` — menu ids are in
  appx.rs; the palette lists every titled command), `src/lib/dialogs.tsx` (`ask`, `confirm`,
  `alert`, `promptText` instead of NSAlert), `src/ui/index.tsx` (Button, IconButton, Sheet,
  MenuButton/showMenu/contextMenu, Toggle, Segmented, Spinner, StatusDot, Mark, SplitHandle),
  `src/theme.css` (tokens: --accent, --done, --warn, --stop, --card, --hairline, …; light+dark).
- State: `src/state/workspace.ts` (tabs/Doc, sidebar mode, panels, dirty files, editor hooks,
  cursor/language, workflowMode, changeCount), `src/state/app.ts` (open project, recents,
  `onProjectOpen/Close`, `onFilesChanged`), `src/engine/{client,engine,bundles}.ts`.
- Layout: `src/layout/MainView.tsx` imports each feature's public components from
  `src/features/<feature>/index.tsx`. Keep those export names and props (you may add props
  with defaults). Put everything else for your feature under `src/features/<feature>/`.
- Icons: `lucide-react` (map SF Symbols to the closest lucide icon).

## Rules for parallel work (six features are being built at the same time)
- Only edit files you own: `src/features/<yours>/**`, `src-tauri/src/<your module>.rs` (and
  new Rust files you create and `mod`-declare in lib.rs), plus the one-line registration in
  lib.rs if you add a module. Do NOT rewrite shared foundation files; if you truly need a
  change there, make a minimal additive edit (re-read the file right before editing) and
  mention it in your report.
- Dependencies: install with `scripts/add-dep.sh npm <pkg…>` or `scripts/add-dep.sh cargo
  <crate…>` (serialises concurrent installs). Never run a bare `npm install`.
- Verify: `npx tsc --noEmit -p .` and `cargo check` (in src-tauri, with
  `export PATH="$HOME/.cargo/bin:$PATH"`). Other features may be mid-edit: only fix errors in
  your own files; keep your Rust compiling at every step (write the module, then register).
- Test like a person with the dev bridge: the app may already be running via
  `npm run dev:bridge` (UI at http://localhost:1420, backend bridge at 127.0.0.1:47900; check
  `curl -s 127.0.0.1:47900/commands`). Vite hot-reloads UI edits; Rust changes need a restart
  of that process — coordinate by only restarting it if `/commands` lacks your new commands,
  using `pkill -f "tauri dev"` then `(mkdir -p /tmp/spar-e2e-default && SPAR_PROJECT=/tmp/spar-e2e-default npm run dev:bridge > /tmp/spar-bridge.log 2>&1 &)`.
  Use Playwright (browser_navigate / snapshot / click / screenshot; screenshots must be saved
  under /Users/chandhu/aegis/.playwright-mcp/). Pure logic: unit tests with vitest
  (`*.test.ts` next to the code, `npx vitest run <file>`).
- Never touch the Mac app's data (`~/Library/Application Support/SPAR/`), never kill the
  Mac app, never `pkill omnigent` broadly. Use a scratch project for destructive tests
  (e.g. `/tmp/spar-e2e-<feature>`), not the user's jobportal (read-only use is fine).
- User-facing text: SPAR branding only — never "omnigent", "yard", "cursor", "worx".
- Report at the end: what you ported (file by file vs the Swift source), what is not yet at
  parity and why, any shared-file edits, deps added, and how you tested.

## Engine port
The Tauri app's engine listens on **127.0.0.1:47827**. Never start anything on 47817: that is
the Mac app's engine, and the Mac app reuses whatever answers there (a foreign engine makes it
lose its agents and chat history). Never stop or restart an engine on 47817.

## Agent sessions cost real usage
Every chat session is a live Claude Code (or other agent) process on the person's account.
Tests must: never open the user's projects (jobportal) in the app — use /tmp scratch folders;
stop every session they create (`stop_session`); and not create a new session on each page
load (fresh headless browser profiles have empty localStorage, so session reuse must not
depend on it alone).

## Visual parity (the Mac app is the reference for every pixel)
The user compares the two apps side by side: colours, sharpness, icons, spacing on every
screen must match the SwiftUI app. Read the SwiftUI view code and reproduce its modifiers.
- **Icons**: on macOS every lucide import is drawn as an SF Symbol (src/ui/icons.tsx, via
  `sf_symbol`). Where the Swift view uses a specific symbol, use exactly that one:
  `<SFSymbol name="ellipsis.circle" size={13} weight="regular" fallback={<Ellipsis size={15}/>} />`
  (import { SFSymbol } from "../../ui/icons"). `size` = the SwiftUI `.font(.system(size:))`
  point size of the symbol (or the text style's size below). Don't edit the global map.
- **Text styles (macOS)**: largeTitle 26, title 22, title2 17, title3 15, headline 13 semibold(700 bold on macOS: use 600),
  body 13, callout 12, subheadline 11, footnote 10, caption 10, caption2 10. `.font(.system(size: N, weight: W))` → font-size N px, weight
  (regular 400, medium 500, semibold 600, bold 700). `.monospaced()` → var(--mono).
- **Colours**: `.primary` → var(--text); `.secondary` → var(--text-2); `.tertiary` → var(--text-3);
  `Theme.accent/done/warn/stop` → var(--accent/--done/--warn/--stop); `Theme.subtle` → var(--subtle);
  `Theme.hairline` → var(--hairline); `Theme.card` → var(--card); `.opacity(x)` on a tint →
  `color-mix(in srgb, var(--accent) x%, transparent)`. Borderless buttons/menus in SwiftUI are
  tinted with the accent colour; `.buttonStyle(.plain)` is not.
- **Controls**: `.buttonStyle(.bordered)` → .btn; `.borderedProminent` → .btn-primary;
  `.controlSize(.small)` → .btn-small; `Picker(...).pickerStyle(.segmented)` → Segmented;
  paddings/radii/spacings as written (`.padding(14)` → 14px; `HStack(spacing: 6)` → gap 6px;
  `RoundedRectangle(cornerRadius: 12)` → 12px).
- **Compare**: capture the running Mac app window with `screencapture -x -o -l<windowId>` (find
  it with CGWindowListCopyWindowInfo, owner "SPAR", the one whose path is not "SPAR")
  — look only, never click or type into the user's Mac app. Render ours headless in dark mode
  with deviceScaleFactor 2 (see the scratchpad's shot.cjs pattern) and compare; sample pixels
  with `uv run --with pillow`.
