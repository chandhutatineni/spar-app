# SPAR

**The SPAR app for Windows, macOS and Linux — one codebase.**

SPAR is spec-driven development with AI agents. You describe what you want; a coding agent takes it
around a loop of four phases, stopping wherever a person has to decide:

```
Discover  →  Design  →  Develop  →  Deliver  ↺
brief, spec   plan, architecture,   code, tests,      push, provision,
questions     threat model, tasks   end-to-end test   deploy, smoke-test
```

This is the cross-platform app, built with [Tauri 2](https://tauri.app) (Rust backend, React +
TypeScript UI). The native macOS app lives in `spar-app/`; both drive the same SPAR CLI and the
same agent engine, so a project moves between them freely.

## Status

| Stage | Scope | State |
|---|---|---|
| 0 — foundation | App shell, open a project, the SPAR loop from `spar next`, agent engine start/stop, first-run setup, CI builds for all three platforms | **done** |
| 1 — core flow | Chat with streaming, question forms, approval and step cards, editor, file tree, terminals, spec/vibe modes, agent picker | next |
| 2 — parity | Document preview and export, diagrams, change review and checkpoints, source control, MCP servers, custom local-model agents | planned |
| 3 — shipping | Signed installers, auto-update | planned |

## How it runs on each platform

The agent engine drives terminal coding agents (Claude Code, Copilot, Codex, …) through a real
terminal, which needs a POSIX tty and `tmux`.

- **macOS / Linux** — the engine runs natively, started through your login shell so it sees the
  same `PATH` as your terminal.
- **Windows** — the engine and the agents run inside **WSL2**; the app itself is a native Windows
  window. Project folders on `C:\` are reached as `/mnt/c/…`. If WSL isn't set up, the app tells you
  to run `wsl --install` in an administrator terminal and restart.

Chats are kept in the app's own data folder (inside WSL's home on Windows), separate from the Mac
app's.

### First run

If something the engine needs is missing, the status bar shows **Set up**. It installs only what's
missing — `uv`, the agent engine, and the SPAR CLI from the wheel shipped inside the app (upgrading
an older SPAR) — and links SPAR's playbooks for the agents. It never installs Claude Code or any
other agent CLI; SPAR offers the agents you already have. `tmux` comes from Homebrew on macOS; on
Linux and WSL it needs `sudo apt install tmux`.

## Develop

Requirements: Node 22+, Rust (stable), and on Linux the WebKitGTK packages listed in
`.github/workflows/build.yml`.

```sh
npm install
npm run tauri dev                              # run the app
SPAR_PROJECT=~/code/my-app npm run tauri dev   # open a project straight away
npm run tauri build                            # installers for this platform
cd src-tauri && cargo test                     # Rust tests
```

Layout:

```
src/                 React UI (App.tsx, app.css)
src-tauri/src/
  platform.rs        running tools in the login shell, or in WSL on Windows
  engine.rs          the agent engine: agent bundles, start, health, stop
  setup.rs           first-run install of what the engine needs
  spar.rs            the SPAR CLI (spar next --json, features)
  lib.rs             Tauri commands
src-tauri/resources/wheels/   the SPAR CLI wheel shipped with the app
```

To ship a newer SPAR CLI, build it (`uv build` in `spar/`) and replace the wheel in
`src-tauri/resources/wheels/`.

## Builds

`.github/workflows/build.yml` builds on Windows, macOS (universal) and Ubuntu for every push and pull
request: `.msi` and `.exe` installers, a `.dmg`, and `.deb`/`.AppImage`. Pushing a `v*` tag attaches
them to a draft GitHub release. Builds are unsigned until the shipping stage.
