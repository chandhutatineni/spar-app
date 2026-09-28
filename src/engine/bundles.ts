// The agents SPAR runs on the engine, as agent specs (config.yaml): a port of the bundle
// writing in the Mac app's Engine.swift. The backend (src-tauri/src/engine.rs) writes them
// and restarts an engine whose loaded prompts differ (bundle fingerprint).
//
//   spar               Claude Code running SPAR's pipeline (its plugin, slash commands, MCP)
//   copilot            GitHub Copilot through the engine's Copilot SDK harness
//   spar-claude-vibe   vibe-mode Claude Code, carrying the app's conventions in its prompt
//   spar-<agent>       the spec-driven variant of every other harness
//   custom-<id>        an agent on your own model (Ollama, LM Studio, OpenAI-compatible),
//   spar-custom-<id>   and its spec-driven variant

import {
  appConventions, CLAUDE_VIBE_AGENT, CustomAgents, customAgentName, customKeyEnv, diagramConventions,
  PORTABLE_SPAR_PROMPT, providerInfo, SLIDES_CONVENTIONS, VARIANT_HARNESSES, type CustomAgent,
} from "../features/chat/catalog";

export interface Bundle { name: string; yaml: string }

const indent = (text: string) => text.split("\n").map((l) => "  " + l).join("\n");

const OS_ENV = `os_env:
  type: caller_process
  cwd: .
  sandbox:
    type: none
`;

/** A generic agent bundle: one harness and a prompt. */
function bundle(name: string, harness: string, description: string, prompt: string, extraConfig = ""): Bundle {
  return {
    name,
    yaml: `spec_version: 1
name: ${name}
description: ${description}
executor:
  type: omnigent
  config:
    harness: ${harness}
${extraConfig}prompt: |
${indent(prompt)}
${OS_ENV}`,
  };
}

/** The spec for SPAR. claude-native runs the real Claude Code CLI, so the SPAR subagents,
 *  skills and MCP server installed by `spar install` load exactly as in a terminal. */
const SPAR_PROMPT = `You are the SPAR engine inside the SPAR desktop app. Work is spec-driven:
Discover (brief and spec), Design (plan and tasks), Develop (build),
Deliver (verify): /spar.init, /spar.explore, /spar.design, /spar.build,
/spar.deliver (and /spar.adopt, /spar.fix, /spar.reconcile, /spar.sync). \`spar next\` decides every step; never skip a human
gate and never approve one yourself. Keep replies short: the app
already shows the artifacts, the stage and the next action.
The app shows a live preview of the project's UI next to you: it runs
the dev server (or loads index.html), reloads on every file change and
sends you any errors the page throws. Do not start servers or open a
browser yourself to look at the UI.
Testing is part of Develop: never call work done without running it.
While building, tick each task in tasks.md (\`- [x] T###\`) the moment it passes, one
at a time, never in a batch at the end: the app shows build progress live from them.
After implementing, run the project's tests and the app locally. When asked for UI first,
build the interface with realistic mock data and stop for review before
integrating. Before delivery the four pillars must pass: unit,
integration, end-to-end (drive the running app with the Playwright MCP
tools) and acceptance (end of /spar.build); record results in
spar/specs/<feature>/test-report.md as | Pillar | Result | Details |.
Deliver never pushes, provisions or deploys without the person's OK at the release review.
Talk like a colleague, in product terms (the engineering principles, the spec, the
plan, the build). The person never types commands, so never mention
\`spar ...\` commands, /spar.* commands, step or playbook names, file paths
under ~/.claude, or what \`spar next\` said; just do it and report the result.
Gates: the app shows Approve and Request changes buttons under your
message. At a gate, summarise what to review and ask for approval there
(or what to change); never print \`spar gate\` lines.
Questions: ask every open question at once as a fenced \`\`\`spar-questions block holding a JSON list, one object per question: {"id": "auth", "question": "How do people sign in?", "options": [{"label": "Email and password", "detail": "simplest"}, {"label": "Google sign-in"}], "recommended": 0} (add "multi": true when several can be picked); the app shows it as a form with the options, room for their own answer, and a Submit — then stop and wait.
Run subagents in the foreground; never end your turn while one is working.
Diagrams: use the tools in spar/config.json "diagrams" (default Python
diagrams for architecture, draw.io for everything else), write only the
source files and embed them in markdown with image links; the app renders them.
Slides: write one HTML deck (docs/slides/<name>.html, one <section> per
slide); the app previews it and exports it to PowerPoint.`;

/** An agent on a model the person runs. The engine gives it file and shell tools; the key
 *  comes from the environment so it never lands on disk. */
function customBundle(a: CustomAgent, spec: boolean): Bundle {
  const name = spec ? `spar-${customAgentName(a)}` : customAgentName(a);
  const prompt = (spec ? PORTABLE_SPAR_PROMPT
    : "You are a coding agent working inside the SPAR desktop app on this project. Use your file and shell tools to read, edit and run code in the current folder.")
    + "\n" + diagramConventions() + "\n" + SLIDES_CONVENTIONS;
  return {
    name,
    yaml: `spec_version: 1
name: ${name}
description: ${a.title} (${a.model}) on ${providerInfo(a.provider).title}
executor:
  type: omnigent
  model: ${JSON.stringify(a.model)}
  connection:
    base_url: ${JSON.stringify(a.baseURL)}
    api_key: \${${customKeyEnv(a)}}
  config:
    harness: openai-agents
prompt: |
${indent(prompt)}
${OS_ENV}`,
  };
}

export async function bundles(): Promise<{ bundles: Bundle[]; env: Record<string, string> }> {
  const conventions = appConventions();
  const list: Bundle[] = [
    bundle("spar", "claude-native", "Spec-driven development with the SPAR pipeline.", SPAR_PROMPT, "    permission_mode: default\n"),
    bundle("copilot", "copilot", "GitHub Copilot's coding agent.", "You are GitHub Copilot working inside the SPAR desktop app on this project."),
    // Vibe-mode Claude runs as SPAR's own agent so the app's conventions (question forms,
    // diagram tools, slides) travel in its prompt: an --append-system-prompt of ours would be
    // overridden by the engine's own.
    bundle(CLAUDE_VIBE_AGENT, "claude-native", "Claude Code inside the SPAR app.", conventions),
    ...VARIANT_HARNESSES.map((v) => bundle(`spar-${v.agent}`, v.harness, `Spec-driven development (SPAR) with ${v.agent}.`, PORTABLE_SPAR_PROMPT + "\n" + conventions)),
  ];
  for (const a of CustomAgents.load()) list.push(customBundle(a, false), customBundle(a, true));
  return { bundles: list, env: await CustomAgents.environment() };
}
