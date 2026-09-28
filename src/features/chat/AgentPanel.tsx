// The agent panel (AgentPanel.swift): header with status, spec-driven / vibe switch, the
// conversation, what the last turn changed, the "now" card, the queue and the composer.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp, AtSign, Brain, Check, ChevronDown, ChevronUp, Ellipsis, FileText, Files, History, ListEnd, Maximize2, Minimize2,
  Paperclip, Play, RefreshCcw, Sparkles, SquarePen, Square, Trash2, X, ArrowLeft, OctagonAlert, BadgeCheck, TextCursor,
  Folder, File, Globe, Diff, AlignLeft, Image, MousePointerClick,
} from "lucide-react";
import { Button, IconButton, MenuButton, Segmented, StatusDot, type MenuEntry } from "../../ui";
import { useCommand } from "../../lib/commands";
import { pickFiles } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import { currentPhase, refreshSpar, selectPhase, startNextIteration, useSpar } from "../../state/spar";
import {
  agentOf, attach, attachFiles, attachImage, availableInteractions, chatHistory, chipId, chipIsImage, chipTitle, choose, continueWork,
  cycleInteraction, dismissTurnChanges, historyStep, interactionOf, isRunning, mentionCandidates, modelTitle,
  moveQueued, newSession, openTerminal, reloadAgentTools, removeChip, resumeChat, send, setDraft, setEffort, setInteraction, setMode, setModel,
  setQueue, setSpecDriven, stop, submit, switchAgent, useChat, type ContextChip,
} from "../../state/chat";
import { availability } from "../../engine/engine";
import {
  allAgents, availabilityLabel, effortTitle, efforts, interactionInfo, models, modes, prettyModel, defaultMode,
} from "./catalog";
import { PHASE, Spar } from "./sparcli";
import { AgentBadge, Caps, Sym, relTime } from "./parts";
import { SFSymbol } from "../../ui/icons";
import { TranscriptView } from "./Entries";
import { BobKeySheet, CopilotSetup, CustomAgentSheet } from "./Sheets";
import { currentTranscript } from "../../state/chat";
import "./chat.css";

export function AgentPanel() {
  const s = useChat();
  const agent = agentOf(s);
  const running = isRunning(s);
  const expanded = useWorkspace((w) => w.chatExpanded);
  const drafting = useSpar((p) => p.draftingNewFeature);
  const [drop, setDrop] = useState(false);
  useAgentCommands();

  const statusText = (() => {
    if (s.connectionError) return s.connectionError;
    switch (s.status) {
      case "running": case "waiting": return s.blockedOn === "permission prompt" ? "Waiting for you" : "Working…";
      case "idle": return "Ready";
      case "starting": return "Connecting…";
      case "failed": return "Stopped with an error";
      default: return s.status.charAt(0).toUpperCase() + s.status.slice(1);
    }
  })();

  const history = chatHistory();
  const historyItems: MenuEntry[] = history.length
    ? history.map((c) => ({ label: `${c.title}  ·  ${relTime(c.date)}`, disabled: c.id === s.sessionId, onClick: () => resumeChat(c.id) }))
    : [{ label: "No earlier chats", disabled: true }];

  return (
    <div className="agent-panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg)", position: "relative" }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrop(true); } }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        const paths = [...e.dataTransfer.files].map((f) => (f as File & { path?: string }).path).filter((p): p is string => !!p);
        if (paths.length) attachFiles(paths);
        else for (const f of e.dataTransfer.files) if (f.type.startsWith("image/")) attachImage(f);
      }}>
      <header className="row" style={{ height: 50, flex: "none", padding: "0 14px", gap: 9, borderBottom: "0.5px solid var(--hairline-strong)" }}>
        <AgentBadge kind={agent} size={22} />
        <div className="col" style={{ gap: 0, minWidth: 0, flex: 1 }}>
          <span className="t-callout" style={{ fontWeight: 600, lineHeight: "15px" }}>{agent.title}</span>
          <span className="row t-caption muted" style={{ gap: 5, minWidth: 0, lineHeight: "13px" }} aria-label="Agent status">
            <StatusDot status={s.status} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={statusText}>{statusText}</span>
          </span>
        </div>
        <IconButton className="agent-head-btn" icon={<SFSymbol name="square.and.pencil" size={13} fallback={<SquarePen size={15} />} />} title="New chat (⌥⌘N)" disabled={running} onClick={newSession} />
        <MenuButton items={historyItems} className="icon-btn agent-head-btn" title="Earlier chats"><SFSymbol name="clock.arrow.circlepath" size={13} fallback={<History size={15} />} /></MenuButton>
        <IconButton className="agent-head-btn" icon={expanded ? <SFSymbol name="arrow.down.right.and.arrow.up.left" size={13} fallback={<Minimize2 size={15} />} />
          : <SFSymbol name="arrow.up.left.and.arrow.down.right" size={13} fallback={<Maximize2 size={15} />} />} title={expanded ? "Back to the editor" : "Expand the chat"}
          onClick={() => useWorkspace.getState().set({ chatExpanded: !expanded })} />
        <MenuButton className="icon-btn agent-head-btn" title="More" items={() => [
          { label: "Watch in Terminal", disabled: !s.terminal, onClick: openTerminal },
          { label: `New Chat with ${agent.title}`, onClick: newSession },
          { label: "MCP Servers…", onClick: () => useWorkspace.getState().open({ kind: "mcp" }) },
          "divider",
          { label: "Refresh", onClick: () => refreshSpar() },
        ]}><SFSymbol name="ellipsis.circle" size={13} fallback={<Ellipsis size={15} />} /></MenuButton>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", width: "100%", maxWidth: expanded ? 860 : undefined, margin: "0 auto" }}>
        <FlowSwitch />
        <TranscriptView />
        {s.lastTurnChanges.length > 0 && !running && <TurnChangesBar />}
        {agent.runsSpar && (drafting || !currentTranscript().hasOpenStep) && <NowCard />}
        {s.queue.length > 0 && <QueueView />}
        <Composer />
      </div>
      {drop && <div className="drop-overlay"><Paperclip size={16} /> Drop to attach</div>}
    </div>
  );
}

function useAgentCommands() {
  const running = useChat(isRunning);
  const sessionId = useChat((s) => s.sessionId);
  const terminal = useChat((s) => s.terminal);
  useCommand("agent-continue", {
    title: "Agent: Continue", group: "Agent", shortcut: "⌘↩",
    enabled: () => !!sessionId && !running && !!agentOf().runsSpar,
    run: () => continueWork(),
  });
  useCommand("agent-stop", { title: "Agent: Stop", group: "Agent", shortcut: "⌘.", enabled: () => running, run: stop });
  useCommand("agent-watch", { title: "Agent: Watch in Terminal", group: "Agent", enabled: () => !!terminal, run: openTerminal });
  useCommand("agent-new-chat", { title: "Agent: New Chat", group: "Agent", shortcut: "⌥⌘N", enabled: () => !running, run: newSession });
  useCommand("reload-agent-tools", { title: "Agent: Apply MCP Servers", group: "Agent", enabled: () => !!sessionId, run: () => reloadAgentTools() });
  useCommand("agent-focus", { title: "Agent: Focus the Composer", group: "Agent", run: () => useChat.setState((s) => ({ focusToken: s.focusToken + 1 })) });
}

/** How the agent works: SPAR's spec-driven workflow, or a plain vibe chat. */
function FlowSwitch() {
  const specDriven = useChat((s) => s.specDriven);
  const running = useChat(isRunning);
  const agent = agentOf(useChat());
  return (
    <div style={{ padding: "6px 12px", display: "flex", justifyContent: "center", minWidth: 0 }}>
    <div className="col" style={{ gap: 4, alignItems: "flex-start", minWidth: 0, maxWidth: "100%" }}>
      <div className="flow-switch" style={{ opacity: running ? 0.5 : 1, pointerEvents: running ? "none" : undefined }} title={running ? "Stop the agent to switch" : undefined}>
        <Segmented value={specDriven ? "spec" : "vibe"} onChange={(v) => setSpecDriven(v === "spec")} options={[
          { value: "spec", label: "Spec-driven" },
          { value: "vibe", label: "Vibe" },
        ]} />
      </div>
      <span className="muted" style={{ fontSize: 10, fontWeight: 500, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {specDriven ? "SPAR's workflow: spec, plan, tasks, build and verify, with your reviews." : `A plain chat: ${agent.title} does what you ask. The SPAR workflow is paused.`}
      </span>
    </div>
    </div>
  );
}

/** What the agent touched in its last turn, one click from each diff. */
function TurnChangesBar() {
  const files = useChat((s) => s.lastTurnChanges);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "0 12px 6px", padding: "7px 12px", borderRadius: 10, background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
      <div className="row" style={{ gap: 8 }}>
        <SFSymbol name="doc.on.doc" size={13} style={{ color: "var(--warn)" }} fallback={<Files size={14} style={{ color: "var(--warn)" }} />} />
        <button className="chat-tool" style={{ width: "auto", fontWeight: 500, gap: 4, fontSize: 12 }} onClick={() => setOpen(!open)}>
          This turn changed {files.length} file{files.length === 1 ? "" : "s"}
          <SFSymbol name="chevron.right" size={10} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }} fallback={<ChevronDown size={11} style={{ transform: open ? undefined : "rotate(-90deg)" }} />} />
        </button>
        <span className="spacer" />
        <Button size="small" kind="primary" style={{ background: "var(--warn)" }} onClick={() => useWorkspace.getState().open({ kind: "review" })}>Review</Button>
        <IconButton icon={<SFSymbol name="xmark" size={11} fallback={<X size={12} />} />} title="Dismiss" size={20} onClick={dismissTurnChanges} />
      </div>
      {open && files.slice(0, 12).map((p) => (
        <button key={p} className="chat-tool mono" style={{ fontSize: 10, marginTop: 4 }} onClick={() => useWorkspace.getState().open({ kind: "diff", path: p })}>
          <FileText size={12} className="muted" /> <span className="summary" style={{ color: "inherit" }}>{p}</span>
        </button>
      ))}
    </div>
  );
}

function QueueView() {
  const queue = useChat((s) => s.queue);
  return (
    <div className="col" style={{ margin: "0 12px 6px", padding: 10, borderRadius: 12, background: "var(--subtle)", gap: 6 }} aria-label="Queued messages">
      <div className="row">
        <span className="row t-caption muted" style={{ fontWeight: 600, gap: 5 }}><SFSymbol name="text.line.last.and.arrowtriangle.forward" size={10} weight="semibold" fallback={<ListEnd size={12} />} /> Queued · sent when the agent finishes</span>
        <span className="spacer" />
        <button className="chat-link t-caption" onClick={() => setQueue([])}>Clear</button>
      </div>
      {queue.map((q, i) => (
        <div key={q.id} className="row queue-row" style={{ gap: 6, background: "var(--field)", borderRadius: 8, padding: "5px 8px" }}>
          <span className="faint t-caption" style={{ width: 14, fontVariantNumeric: "tabular-nums", textAlign: "center" }}>{i + 1}</span>
          <input className="text-field" style={{ border: 0, height: 22, padding: 0, background: "transparent", boxShadow: "none", fontSize: 12 }} value={q.text}
            onChange={(e) => setQueue(queue.map((x) => (x.id === q.id ? { ...x, text: e.target.value } : x)))} />
          <IconButton icon={<SFSymbol name="chevron.up" size={11} fallback={<ChevronUp size={12} />} />} size={20} title="Move up" disabled={i === 0} onClick={() => moveQueued(i, -1)} />
          <IconButton icon={<SFSymbol name="chevron.down" size={11} fallback={<ChevronDown size={12} />} />} size={20} title="Move down" disabled={i === queue.length - 1} onClick={() => moveQueued(i, 1)} />
          <IconButton icon={<SFSymbol name="trash" size={11} fallback={<Trash2 size={12} />} />} size={20} title="Remove" onClick={() => setQueue(queue.filter((x) => x.id !== q.id))} />
        </div>
      ))}
    </div>
  );
}

// ---- Now card --------------------------------------------------------------------------

/** The one next thing, straight from `spar next`. */
function NowCard() {
  const sp = useSpar();
  const running = useChat(isRunning);
  const sessionId = useChat((s) => s.sessionId);
  const activeTab = useWorkspace((w) => w.activeTab);
  const next = sp.next;
  const cur = currentPhase(sp);
  const tint = cur ? PHASE[cur].tint : "var(--accent)";
  const card = (icon: React.ReactNode, color: string, title: string, detail: string, actions?: React.ReactNode, phaseTitle?: string) => (
    <div className="card col" style={{ margin: "0 12px 8px", padding: 14, gap: 10 }} aria-label={title}>
      {phaseTitle && <Caps color={color}>{phaseTitle}</Caps>}
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <span style={{ color, flex: "none", display: "inline-flex", width: 22, justifyContent: "center", paddingTop: 1 }}>{icon}</span>
        <div className="col" style={{ gap: 3, minWidth: 0 }}>
          <span className="t-headline">{title}</span>
          <span className="muted t-callout">{detail}</span>
        </div>
      </div>
      {actions && <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>{actions}</div>}
    </div>
  );
  if (sp.draftingNewFeature || (!sp.feature && next?.action !== "run")) {
    return card(<SFSymbol name="sparkles" size={15} fallback={<Sparkles size={18} />} />, PHASE.discover.tint, "New iteration", "Type your idea below and press ↩. SPAR turns it into a spec.");
  }
  if (!next || running) return null;
  switch (next.action) {
    case "gate": {
      const phase = (Object.keys(PHASE) as (keyof typeof PHASE)[]).find((p) => PHASE[p].gate === next.gate) ?? "discover";
      const onPage = sp.phase === phase && activeTab.kind === "phase";
      return card(<SFSymbol name="person.crop.circle.badge.checkmark" size={15} fallback={<BadgeCheck size={18} />} />, PHASE[phase].tint, Spar.actionTitle(next), `SPAR has stopped for your decision. Approve or request changes in ${PHASE[phase].title}.`,
        onPage ? <span className="row t-caption muted" style={{ gap: 4 }}><SFSymbol name="arrow.left" size={10} fallback={<ArrowLeft size={11} />} /> Review is open on the left</span>
          : <Button kind="primary" style={{ background: PHASE[phase].tint }} icon={<SFSymbol name="arrow.left" size={12} fallback={<ArrowLeft size={12} />} />} onClick={() => selectPhase(phase)}>Go to review</Button>);
    }
    case "done":
      return card(<SFSymbol name="checkmark.seal.fill" size={15} fallback={<BadgeCheck size={18} />} />, "var(--done)", "Iteration delivered", next.reason,
        <Button kind="primary" style={{ background: PHASE.discover.tint }} icon={<SFSymbol name="arrow.triangle.2.circlepath" size={12} fallback={<RefreshCcw size={12} />} />} onClick={startNextIteration}>Next iteration</Button>);
    case "blocked":
      return card(<SFSymbol name="exclamationmark.octagon.fill" size={15} fallback={<OctagonAlert size={18} />} />, "var(--stop)", "Blocked", next.reason,
        <Button onClick={() => send(`SPAR says this feature is blocked: ${next.reason} Explain the options.`)}>Ask the agent</Button>);
    case "prompt":
      return card(<SFSymbol name="text.cursor" size={15} fallback={<TextCursor size={18} />} />, PHASE.discover.tint, Spar.actionTitle(next), next.reason);
    case "select":
      return card(<SFSymbol name="list.bullet.rectangle" size={15} fallback={<Files size={18} />} />, tint, Spar.actionTitle(next), next.reason,
        <div className="col" style={{ gap: 6, width: "100%" }}>
          {(next.options ?? []).map((o) => (
            <button key={o.id} className="btn" onClick={() => choose(o)} style={{ height: "auto", padding: "7px 10px", flexDirection: "column", alignItems: "flex-start", whiteSpace: "normal", textAlign: "left" }}>
              <span style={{ fontWeight: 500 }}>{o.label}</span>
              {o.detail && <span className="t-caption muted">{o.detail}</span>}
            </button>
          ))}
        </div>);
    default:
      return card(cur ? <Sym name={PHASE[cur].icon} pt={15} /> : <SFSymbol name="arrow.forward.circle.fill" size={15} fallback={<Play size={18} />} />, tint, Spar.actionTitle(next), next.reason,
        <Button kind="primary" style={{ background: tint, minWidth: 90 }} icon={<SFSymbol name="play.fill" size={12} fallback={<Play size={11} />} />} disabled={!sessionId}
          onClick={() => { const extra = useChat.getState().draft; setDraft(""); continueWork(extra); }}>Continue</Button>,
        cur ? PHASE[cur].title : undefined);
  }
}

// ---- Composer --------------------------------------------------------------------------

/** ContextChip.symbol in Composer.swift. */
const chipSymbol = (c: ContextChip): [string, React.ReactNode] => {
  switch (c.kind) {
    case "file": return ["doc", <File size={11} />];
    case "folder": return ["folder", <Folder size={11} />];
    case "changes": return ["plusminus", <Diff size={11} />];
    case "previewErrors": return ["exclamationmark.octagon", <OctagonAlert size={11} />];
    case "devLog": return ["text.alignleft", <AlignLeft size={11} />];
    case "web": return ["globe", <Globe size={11} />];
    case "refine": return ["arrow.triangle.2.circlepath", <RefreshCcw size={11} />];
    case "selection": return ["text.cursor", <MousePointerClick size={11} />];
    case "attachment": return chipIsImage(c) ? ["photo", <Image size={11} />] : ["paperclip", <Paperclip size={11} />];
  }
};
const chipIcon = (c: ContextChip, pt = 10.5) => { const [n, fb] = chipSymbol(c); return <SFSymbol name={n} size={pt} fallback={fb} />; };
const chipTint = (c: ContextChip) => (c.kind === "refine" ? PHASE[c.phase].tint : c.kind === "previewErrors" ? "var(--stop)" : "var(--accent)");

function Composer() {
  const s = useChat();
  const agent = agentOf(s);
  const running = isRunning(s);
  const sp = useSpar();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [mention, setMention] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ContextChip[]>([]);

  useEffect(() => { if (s.focusToken) ref.current?.focus(); }, [s.focusToken]);
  useEffect(() => {
    const m = s.draft.match(/(^|\s)@([\w./-]*)$/);
    setMention(m ? m[2] : null);
  }, [s.draft]);
  useEffect(() => {
    if (mention == null) return;
    let live = true;
    mentionCandidates(mention).then((c) => live && setCandidates(c));
    return () => { live = false; };
  }, [mention]);
  // Grow with the text, up to about 14 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 280) + "px";
  }, [s.draft]);

  const startsFeature = !!agent.runsSpar && (sp.draftingNewFeature || sp.next?.action === "prompt");
  const refine = s.chips.find((c) => c.kind === "refine");
  const interaction = interactionOf(s);
  const placeholder = startsFeature ? "Describe what you want to build…"
    : refine && refine.kind === "refine" ? PHASE[refine.phase].revisePrompt
    : interaction === "ask" ? "Ask about the code…"
    : interaction === "plan" ? "What should we plan?"
    : interaction === "debug" ? "Describe the bug, or just send to use the errors and logs…"
    : agent.runsSpar ? "Ask SPAR, or give an instruction… (@ for context)" : `Message ${agent.title}… (@ for context)`;
  const hint = startsFeature ? "↩ to start · SPAR writes the spec" : "↩ to send · ⇧⇥ to switch mode";

  const pick = (chip: ContextChip) => {
    setDraft(useChat.getState().draft.replace(/@[\w./-]*$/, ""));
    setMention(null);
    attach(chip);
  };
  const doSubmit = () => { setMention(null); submit(); };

  return (
    <div className={`composer ${focused || running ? "active" : ""} ${running ? "busy" : ""} ${focused ? "focused" : ""}`}
      onPaste={(e) => {
        const imgs = [...e.clipboardData.items].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is globalThis.File => !!f);
        if (imgs.length) { e.preventDefault(); imgs.forEach((f) => attachImage(f)); }
      }}>
      {mention != null && (
        <div className="mention-list" role="listbox" aria-label="Add context">
          <span className="t-caption muted" style={{ fontWeight: 600, padding: "4px 8px" }}>{mention ? `Matching “${mention}”` : "Add context"}</span>
          {!candidates.length && <span className="faint" style={{ padding: 8, fontSize: 12 }}>No matches</span>}
          {candidates.map((c, i) => (
            <button key={chipId(c)} className={`mention-item ${i === 0 ? "first" : ""}`} onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
              <span className="muted" style={{ width: 16, display: "inline-flex", justifyContent: "center" }}>{chipIcon(c, 12)}</span>
              <span style={{ fontWeight: i === 0 ? 600 : 400 }}>{chipTitle(c)}</span>
              {(c.kind === "file" || c.kind === "folder") && <span className="faint t-caption" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl" }}>{c.path}</span>}
              <span className="spacer" />
              {i === 0 && <span className="faint t-caption">↩</span>}
            </button>
          ))}
        </div>
      )}
      {s.chips.length > 0 && (
        <div className="row" style={{ gap: 6, overflowX: "auto" }}>
          {s.chips.map((c) => (
            <span key={chipId(c)} className="chip" style={{ color: chipTint(c), background: `color-mix(in srgb, ${chipTint(c)} 10%, transparent)` }}>
              {chipIcon(c)} {chipTitle(c)}
              <button title="Remove" onClick={() => removeChip(c)}><SFSymbol name="xmark" size={8} weight="bold" fallback={<X size={9} strokeWidth={3} />} /></button>
            </span>
          ))}
        </div>
      )}
      <textarea ref={ref} rows={3} value={s.draft} placeholder={placeholder} aria-label="Message the agent"
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (mention != null && candidates[0]) pick(candidates[0]); else doSubmit();
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            cycleInteraction();
          } else if (e.key === "Escape" && mention != null) {
            e.preventDefault();
            setMention(null);
          } else if (e.key === "ArrowUp" && mention == null && !s.draft.includes("\n")) {
            // ↑ / ↓ walk through earlier messages, as in a terminal — only while the draft is a single line.
            if (historyStep(-1)) e.preventDefault();
          } else if (e.key === "ArrowDown" && mention == null && s.historyIndex != null && !s.draft.includes("\n")) {
            if (historyStep(1)) e.preventDefault();
          }
        }} />
      <div className="row" style={{ gap: 6 }}>
        <OptionBar />
        <IconButton icon={<SFSymbol name="paperclip" size={11} fallback={<Paperclip size={14} />} />} title="Attach files or images (or drop them on the chat, or paste an image)"
          onClick={async () => attachFiles(await pickFiles())} />
        <IconButton icon={<SFSymbol name="at" size={11} fallback={<AtSign size={14} />} />} title="Add context (@)"
          onClick={() => { const d = useChat.getState().draft; setDraft(d + (!d || d.endsWith(" ") ? "@" : " @")); ref.current?.focus(); }} />
        {running && (
          <button className="btn btn-small composer-btn" title="Stop (⌘.)" aria-label="Stop" onClick={stop}>
            <SFSymbol name="stop.fill" size={11} fallback={<Square size={11} fill="currentColor" />} />
          </button>
        )}
        <button className="btn btn-primary btn-small composer-btn composer-send" style={{ ["--tint" as string]: agent.tint }} title={running ? "Queue for after the current step" : hint}
          aria-label={running ? "Queue" : "Send"} disabled={!s.draft.trim() || !s.sessionId} onClick={doSubmit}>
          {running ? <SFSymbol name="text.line.last.and.arrowtriangle.forward" size={11} weight="semibold" fallback={<ListEnd size={13} />} />
            : <SFSymbol name="arrow.up" size={11} weight="semibold" fallback={<ArrowUp size={14} strokeWidth={2.6} />} />}
        </button>
      </div>
    </div>
  );
}

/** Agent, model, reasoning effort and approval mode. Choices apply to the current session
 *  and are remembered per agent. */
function OptionBar() {
  const s = useChat();
  const agent = agentOf(s);
  const [sheet, setSheet] = useState<"copilot" | "bob" | "custom" | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  useLayoutEffect(() => {
    const el = ref.current, m = measure.current;
    if (!el || !m) return;
    const fit = () => {
      const avail = el.clientWidth;
      const widths = Array.from(m.children).map((c) => (c as HTMLElement).scrollWidth);
      const i = widths.findIndex((w) => w <= avail);
      setLevel((i < 0 ? 2 : i) as 0 | 1 | 2);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(m);
    return () => ro.disconnect();
  });
  useEffect(() => {
    import("../../lib/api").then(({ app }) => app.info()).then((i) => { if (i.env.SPAR_SHEET === "customagent") setSheet("custom"); }).catch(() => {});
  }, []);
  const interaction = interactionOf(s);
  const info = interactionInfo(interaction);
  const mode = s.prefs.mode ?? defaultMode(agent);
  const modeInfo = modes(agent).find((m) => m.id === mode);

  const agentItems = (): MenuEntry[] => {
    const all = allAgents();
    const ready = all.filter((k) => availability(k.name) === "ready");
    const unavailable = all.filter((k) => availability(k.name) !== "ready");
    return [
      { section: "Agents" },
      ...ready.map((k): MenuEntry => ({ label: `${k.title} — ${k.subtitle}`, checked: k.name === s.baseAgent.name, onClick: () => switchAgent(k) })),
      "divider",
      { label: "Spec-driven vs vibe: what's the difference?", onClick: () => useWorkspace.getState().set({ showAgentInfo: true }) },
      { label: "Add an agent on your own model (Ollama, LM Studio…)…", onClick: () => setSheet("custom") },
      { label: "IBM Bob API key…", onClick: () => setSheet("bob") },
      ...(unavailable.length ? [{ section: "Not available on this computer" } as MenuEntry, ...unavailable.map((k): MenuEntry => k.family === "copilot"
        ? { label: "Set up GitHub Copilot…", onClick: () => setSheet("copilot") }
        : { label: `${k.title} · ${availabilityLabel(availability(k.name))}`, disabled: true })] : []),
    ];
  };

  // Like SwiftUI's ViewThatFits: full labels, then shorter ones, then icons only — the first
  // row that fits the space left of the attach / send buttons.
  const pills = (level: 0 | 1 | 2) => {
    const compact = level >= 1;
    const iconsOnly = level === 2;
    return (
      <>
      <MenuButton className="opt-pill" title={`Mode: ${info.title} — ${info.detail}`} items={() => [
        { section: "Mode  ·  ⇧⇥ to switch" },
        ...availableInteractions(s).map((m): MenuEntry => { const x = interactionInfo(m); return { label: `${x.title}  ·  ${x.detail}`, checked: m === interaction, onClick: () => setInteraction(m) }; }),
      ]}>
        <span style={{ color: interaction === "agent" ? undefined : "var(--accent)", gap: 4 }} className="row"><Sym name={info.icon} pt={10.5} weight="medium" />{!iconsOnly && <span>{info.title}</span>}</span>
        <ChevronDown size={9} style={{ opacity: 0.5 }} />
      </MenuButton>
      <MenuButton className="opt-pill" title="Agent" items={agentItems}>
        <Sym name={agent.icon} pt={10.5} weight="medium" />{!iconsOnly && <span>{agent.title}</span>}<ChevronDown size={9} style={{ opacity: 0.5 }} />
      </MenuButton>
      {!iconsOnly && (
        <MenuButton className="opt-pill" title={s.sessionModel ? `Model · last reply used ${prettyModel(s.sessionModel)}` : "Model"} items={() => [
          ...models(agent).map((m): MenuEntry => ({ label: `${m.title}  ·  ${m.detail}`, checked: s.prefs.model === m.id, onClick: () => setModel(m.id) })),
          "divider",
          { label: "Custom model…", onClick: () => setCustom(s.prefs.model ?? "") },
        ]}>
          <Sym name="Cpu" pt={10.5} weight="medium" /><span>{modelTitle(s)}</span><ChevronDown size={9} style={{ opacity: 0.5 }} />
        </MenuButton>
      )}
      {efforts(agent).length > 0 && (
        <MenuButton className="opt-pill" title={`Reasoning effort: ${effortTitle(s.prefs.effort)}`} items={() => [
          { section: "Reasoning effort" },
          { label: "Default", checked: s.prefs.effort == null, onClick: () => setEffort(null) },
          ...efforts(agent).map((e): MenuEntry => ({ label: effortTitle(e), checked: s.prefs.effort === e, onClick: () => setEffort(e) })),
        ]}>
          <SFSymbol name="brain" size={10.5} weight="medium" fallback={<Brain size={11} />} />{!compact && <span>{effortTitle(s.prefs.effort)}</span>}<ChevronDown size={9} style={{ opacity: 0.5 }} />
        </MenuButton>
      )}
      {modes(agent).length > 0 && !info.readOnly && (
        <MenuButton className="opt-pill" title={`Approval mode: ${modeInfo?.title ?? ""}`} items={() => [
          { section: "Approvals in Agent mode" },
          ...modes(agent).map((m): MenuEntry => ({ label: `${m.title}  ·  ${m.detail}`, checked: m.id === mode, onClick: () => setMode(m.id) })),
        ]}>
          <span className="row" style={{ gap: 4, color: mode === "bypassPermissions" ? "var(--stop)" : undefined }}>
            <Sym name={modeInfo?.icon ?? "Hand"} pt={10.5} weight="medium" />{!compact && modeInfo?.title}
          </span>
          <ChevronDown size={9} style={{ opacity: 0.5 }} />
        </MenuButton>
      )}
      </>
    );
  };

  return (
    <div ref={ref} style={{ flex: "1 1 auto", minWidth: 0, position: "relative", overflow: "hidden" }}>
      <div className="row" style={{ gap: 2, flexWrap: "nowrap" }}>{pills(level)}</div>
      <div ref={measure} aria-hidden inert style={{ position: "absolute", left: 0, top: 0, visibility: "hidden", pointerEvents: "none" }}>
        {([0, 1, 2] as const).map((l) => <div key={l} className="row" style={{ gap: 2, flexWrap: "nowrap", width: "max-content" }}>{pills(l)}</div>)}
      </div>
      {custom != null && <CustomModelSheet value={custom} agentTitle={agent.title} onClose={() => setCustom(null)} />}
      {sheet === "copilot" && <CopilotSetup onClose={() => setSheet(null)} />}
      {sheet === "bob" && <BobKeySheet onClose={() => setSheet(null)} />}
      {sheet === "custom" && <CustomAgentSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

function CustomModelSheet({ value, agentTitle, onClose }: { value: string; agentTitle: string; onClose: () => void }) {
  const [v, setV] = useState(value);
  const apply = () => { if (v.trim()) { setModel(v.trim()); onClose(); } };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sheet" style={{ width: 340 }} role="dialog" aria-label="Custom model">
        <div className="sheet-title">Custom model</div>
        <div className="t-caption muted" style={{ marginBottom: 10 }}>Any model id {agentTitle} accepts, for example claude-opus-5-5 or gpt-5.</div>
        <input className="text-field" autoFocus placeholder="Model id" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply(); if (e.key === "Escape") onClose(); }} />
        <div className="sheet-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!v.trim()} onClick={apply} icon={<Check size={12} />}>Use model</Button>
        </div>
      </div>
    </div>
  );
}
