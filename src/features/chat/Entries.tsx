// The conversation: messages, tool rows, approval cards, SPAR's step cards and milestones
// (TranscriptView, EntryView, StepCardView and MilestoneView in AgentPanel.swift).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight, Check, CheckCircle2, ChevronRight, CircleCheck, CircleDashed, Hand, History, Play, RotateCw, Send, ShieldCheck, ShieldX, XCircle, RefreshCcw,
} from "lucide-react";
import { Button, Spinner } from "../../ui";
import { useWorkspace } from "../../state/workspace";
import { joinPath } from "../../lib/api";
import { artifactPath, startNextIteration, useSpar } from "../../state/spar";
import {
  allowAll, answer, approveUI, choose, continueWork, decide, isRunning, keepWaiting, requestUIChanges, restoreCheckpoint, send,
  setDraft, stopAndRetry, useChat,
} from "../../state/chat";
import type { Entry, StepCard } from "./transcript";
import { FIX_GATE, PHASE, Spar, TENETS_GATE, stageTint, stageTitle } from "./sparcli";
import { parseQuestions } from "./questions";
import { QuestionForm } from "./QuestionForm";
import { Markdown, Caps } from "./parts";
import { SFSymbol } from "../../ui/icons";

const sf = (name: string, pt: number, fallback: React.ReactNode, style?: React.CSSProperties, weight?: string) =>
  <SFSymbol name={name} size={pt} style={style} weight={weight} fallback={fallback} />;

const openFile = (p: string) => useWorkspace.getState().openFile(p);

export function TranscriptView({ empty }: { empty?: React.ReactNode }) {
  const entries = useChat((s) => s.entries);
  const running = useChat(isRunning);
  const blockedOn = useChat((s) => s.blockedOn);
  const [shown, setShown] = useState(250);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries, running]);
  const visible = entries.slice(-shown);
  // Which question forms were answered by a later message of the person's.
  const lastUser = entries.map((e) => e.kind.type).lastIndexOf("user");
  return (
    <div ref={ref} className="chat-scroll" role="log" aria-label="Conversation"
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {!entries.length && (empty ?? (
        <div className="col" style={{ alignItems: "center", paddingTop: 60, gap: 8 }}>
          <img src="/spar.png" width={34} height={34} alt="" style={{ opacity: 0.9 }} />
          <span className="muted">The agent's work appears here.</span>
        </div>
      ))}
      {entries.length > shown && (
        <button className="chat-link" style={{ alignSelf: "center" }} onClick={() => setShown(shown + 250)}>Show {Math.min(250, entries.length - shown)} earlier messages</button>
      )}
      {visible.map((e) => <EntryView key={e.id} entry={e} answeredLater={entries.indexOf(e) < lastUser} />)}
      {running && blockedOn == null && (
        <div className="row muted" style={{ gap: 8, fontSize: 12 }}><Spinner small /> Working</div>
      )}
    </div>
  );
}

function EntryView({ entry, answeredLater }: { entry: Entry; answeredLater: boolean }) {
  const k = entry.kind;
  switch (k.type) {
    case "user": return <UserMessage id={entry.id} text={k.text} />;
    case "assistant": {
      const block = parseQuestions(k.text);
      if (block) {
        return (
          <div className="col" style={{ gap: 10 }}>
            {block.before && <Markdown text={block.before} />}
            <QuestionForm entryId={entry.id} questions={block.questions} answeredLater={answeredLater} />
            {block.after && <Markdown text={block.after} />}
          </div>
        );
      }
      return <Markdown text={k.text} />;
    }
    case "tool": return <ToolRow name={k.name} summary={k.summary} output={k.output} failed={k.failed} />;
    case "approval":
      if (k.state !== "pending") {
        return (
          <div className="row" style={{ gap: 7, fontSize: 12, minWidth: 0 }}>
            {k.state === "allowed" ? sf("checkmark.shield", 12, <ShieldCheck size={14} />, { color: "var(--text-2)" }) : sf("xmark.shield", 12, <ShieldX size={14} />, { color: "var(--stop)" })}
            <span style={{ fontWeight: 500 }}>{k.state === "allowed" ? "Allowed" : "Denied"}</span>
            <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.preview ?? k.message.replace(/\*\*/g, "")}</span>
          </div>
        );
      }
      return (
        <div className="card col" style={{ padding: 12, gap: 8 }} role="group" aria-label="Approval">
          <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            {sf("hand.raised.fill", 13, <Hand size={15} />, { color: "var(--warn)", marginTop: 2 })}
            <Markdown text={k.message} />
          </div>
          {k.preview && (
            <div className="mono-small selectable" style={{ color: "var(--text-2)", background: "var(--subtle)", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {k.preview.length > 800 ? k.preview.slice(0, 800) + "…" : k.preview}
            </div>
          )}
          <div className="row">
            <button className="chat-link" style={{ fontSize: 11 }} title="Approve this and every later request in this chat" onClick={() => allowAll(entry)}>Allow all in this chat</button>
            <span className="spacer" />
            <Button size="small" onClick={() => answer(entry, false)}>Deny</Button>
            <Button size="small" kind="primary" onClick={() => answer(entry, true)}>Allow</Button>
          </div>
        </div>
      );
    case "step": return <StepCardView card={k.card} />;
    case "milestone": return <Milestone from={k.from} to={k.to} />;
    case "note": return <div className="chat-note">{k.text}</div>;
  }
}

function UserMessage({ id, text }: { id: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const hasCheckpoint = useChat((s) => !!s.checkpoints[id]);
  return (
    <div className="col" style={{ alignItems: "flex-end", gap: 4 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={`chat-user selectable ${expanded ? "" : "clamped"}`} onDoubleClick={() => setExpanded(!expanded)}>{text}</div>
      {hasCheckpoint && (hover || confirm) && (confirm ? (
        <div className="row t-caption" style={{ gap: 6 }}>
          <span className="muted">Put every file back as it was before this message?</span>
          <Button size="small" className="btn-mini" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button size="small" kind="primary" className="btn-mini" style={{ background: "var(--warn)" }} onClick={() => { setConfirm(false); restoreCheckpoint(id); }}>Restore</Button>
        </div>
      ) : (
        <button className="chat-link row t-caption" style={{ color: "var(--text-2)", gap: 4 }} title="Roll back all file edits made after this message" onClick={() => setConfirm(true)}>
          {sf("clock.arrow.circlepath", 10, <History size={12} />)} Restore checkpoint
        </button>
      ))}
    </div>
  );
}

function ToolRow({ name, summary, output, failed }: { name: string; summary: string; output: string | null; failed: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="chat-tool" onClick={() => output != null && setOpen(!open)}>
        {failed ? sf("xmark.circle", 12, <XCircle size={14} />, { color: "var(--stop)" })
          : output == null ? sf("circle.dotted", 12, <CircleDashed size={14} />, { color: "var(--accent)" })
          : sf("checkmark.circle", 12, <CircleCheck size={14} />, { color: "var(--text-2)" })}
        <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{name}</span>
        <span className="summary" title={summary}>{summary}</span>
        {output != null && sf("chevron.right", 12, <ChevronRight size={12} />, { color: "var(--text-3)", transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" })}
      </button>
      {open && output != null && <div className="chat-output selectable">{output.length > 6000 ? output.slice(0, 6000) + "\n…" : output || "(no output)"}</div>}
    </div>
  );
}

/** "Discover complete · now in Design" */
function Milestone({ from, to }: { from: string; to: string }) {
  const tint = stageTint(to);
  const line = <span style={{ flex: 1, height: 1, background: `color-mix(in srgb, ${tint} 30%, transparent)` }} />;
  return (
    <div className="row t-caption" style={{ gap: 8, padding: "4px 0" }}>
      {line}
      <span className="row" style={{ gap: 5, whiteSpace: "nowrap" }}>
        {sf("checkmark.circle.fill", 10, <CheckCircle2 size={13} />, { color: stageTint(from) })}
        <span className="muted">{stageTitle(from)} complete</span>
        {sf("arrow.right", 10, <ArrowRight size={10} />, { color: "var(--text-3)" })}
        <span style={{ fontWeight: 600, color: tint }}>{to === "done" ? "Delivered" : `now in ${stageTitle(to)}`}</span>
      </span>
      {line}
    </div>
  );
}

/** The next SPAR step, inline in the conversation. */
function StepCardView({ card }: { card: StepCard }) {
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useChat(isRunning);
  const sessionId = useChat((s) => s.sessionId);
  const { gates, next, sparDir, architecture, feature } = useSpar();
  const [compact, setCompact] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < 400));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (card.resolved) {
    return <div className="row t-caption" style={{ gap: 6 }}>{sf("checkmark.circle", 10, <CircleCheck size={12} />, { color: "var(--text-3)" })}<span className="muted">{card.title}</span></div>;
  }
  const tint = stageTint(card.stage);
  const label = card.action === "gate" || card.action === "ui-review" ? "· YOUR REVIEW" : card.action === "answer" ? "· YOUR ANSWER" : card.action === "setup" ? "· NEEDS YOU" : "· NEXT STEP";
  const primary = { background: tint, color: "#fff", borderColor: "transparent" };

  const doDecide = async (approve: boolean) => {
    if (!card.gate) return;
    setBusy(true);
    const err = await decide(card.gate, approve, note);
    setError(err);
    setBusy(false);
    if (!err && !approve) continueWork(`Changes requested at ${card.gate}: ${note}`);
  };

  let actions: React.ReactNode;
  switch (card.action) {
    case "gate": {
      const reads: React.ReactNode[] = [];
      if (!compact) {
        if (card.gate === FIX_GATE) {
          reads.push(<Button key="fix" size="small" onClick={() => next?.scope && openFile(joinPath(sparDir, `fixes/${next.scope}.md`))}>Read the fix record</Button>);
          reads.push(<Button key="rev" size="small" onClick={() => useWorkspace.getState().open({ kind: "review" })}>Review the change</Button>);
        } else if (card.gate === TENETS_GATE) {
          for (const [file, t] of [["tenets.md", "Principles"], ["standards.md", "Standards"], ["references.md", "Sources"]])
            reads.push(<Button key={file} size="small" onClick={() => openFile(joinPath(sparDir, file))}>{t}</Button>);
        } else {
          for (const file of gates[card.gate ?? ""]?.artifacts ?? [])
            reads.push(<Button key={file} size="small" onClick={() => { const p = artifactPath(file); if (p) openFile(p); }}>Read {Spar.artifactTitle(file).toLowerCase()}</Button>);
          // The plan review is where the architecture document gets read.
          if (card.gate === "approve-plan" && architecture) reads.push(<Button key="arch" size="small" onClick={() => openFile(architecture)}>Read architecture</Button>);
        }
      }
      const release = card.gate === "approve-release";
      actions = (
        <>
          {reads}
          <span className="spacer" />
          {requesting ? (
            <>
              <Button size="small" onClick={() => setRequesting(false)}>Cancel</Button>
              <Button size="small" onClick={() => doDecide(false)} disabled={!note.trim() || busy}>Send back</Button>
            </>
          ) : (
            <>
              <Button size="small" onClick={() => setRequesting(true)}>{compact ? "Changes…" : "Request changes"}</Button>
              <Button size="small" style={primary} icon={release ? sf("paperplane.fill", 11, <Send size={12} />) : sf("checkmark", 11, <Check size={12} />)} onClick={() => doDecide(true)} disabled={busy || running}>
                {release ? (compact ? "Ship" : "Push & deploy") : (compact ? "Approve" : "Approve & continue")}
              </Button>
            </>
          )}
        </>
      );
      break;
    }
    case "ui-review":
      actions = (
        <>
          {!compact && <Button size="small" onClick={() => useWorkspace.getState().open({ kind: "preview" })}>Open preview</Button>}
          <span className="spacer" />
          {requesting ? (
            <>
              <Button size="small" onClick={() => setRequesting(false)}>Cancel</Button>
              <Button size="small" disabled={!note.trim()} onClick={() => { requestUIChanges(note); setNote(""); setRequesting(false); }}>Send changes</Button>
            </>
          ) : (
            <>
              <Button size="small" onClick={() => setRequesting(true)}>Request UI changes</Button>
              <Button size="small" style={primary} icon={sf("checkmark", 11, <Check size={12} />)} disabled={running} onClick={() => approveUI()}>Approve UI & integrate</Button>
            </>
          )}
        </>
      );
      break;
    case "done":
      actions = (
        <>
          <span className="spacer" />
          <Button size="small" onClick={() => feature && send(Spar.stepRequest("retro", feature))}>Retrospective</Button>
          <Button size="small" style={{ ...primary, background: PHASE.discover.tint }} icon={sf("arrow.triangle.2.circlepath", 11, <RefreshCcw size={12} />)} onClick={startNextIteration}>Next iteration</Button>
        </>
      );
      break;
    case "blocked":
      actions = <><span className="spacer" /><Button size="small" onClick={() => send(`SPAR says this is blocked: ${card.reason} Explain the options.`)}>Ask SPAR why</Button></>;
      break;
    case "prompt":
      actions = <span className="t-caption muted">Describe what to build below.</span>;
      break;
    case "setup":
      actions = (
        <>
          {!compact && <Button size="small" onClick={() => useWorkspace.getState().setShowTerminal(true)}>Open terminal</Button>}
          <span className="spacer" />
          <Button size="small" style={primary} icon={sf("checkmark", 11, <Check size={12} />)} disabled={running || !sessionId} onClick={() => continueWork("I've set it up.")}>Done, continue</Button>
        </>
      );
      break;
    case "stalled":
      actions = (
        <>
          <span className="spacer" />
          <Button size="small" onClick={keepWaiting}>Keep waiting</Button>
          <Button size="small" style={primary} icon={sf("arrow.clockwise", 11, <RotateCw size={12} />)} onClick={stopAndRetry}>Stop and retry</Button>
        </>
      );
      break;
    case "answer":
      actions = (
        <>
          <span className="spacer" />
          <Button size="small" style={primary} icon={sf("checkmark", 11, <Check size={12} />)} disabled={running || !sessionId}
            onClick={() => { setDraft(""); send("Use your recommendations for all of them."); }}>Use the recommendations</Button>
        </>
      );
      break;
    case "select":
      actions = (
        <div className="col" style={{ gap: 6, width: "100%" }}>
          {(next?.options ?? []).map((o) => (
            <button key={o.id} className="btn" disabled={running} onClick={() => choose(o)}
              style={{ height: "auto", padding: "7px 10px", justifyContent: "flex-start", textAlign: "left", flexDirection: "column", alignItems: "flex-start", whiteSpace: "normal" }}>
              <span style={{ fontWeight: 600 }}>{o.label}</span>
              {o.detail && <span className="t-caption muted">{o.detail}</span>}
            </button>
          ))}
        </div>
      );
      break;
    default:
      actions = (
        <>
          {!compact && <span className="faint t-caption">or type “continue”</span>}
          <span className="spacer" />
          <Button size="small" style={primary} icon={sf("play.fill", 11, <Play size={11} />)} disabled={running || !sessionId} onClick={() => continueWork()} title="Continue (⌘↩)">Continue</Button>
        </>
      );
  }

  return (
    <div ref={ref} className="step-card" role="group" aria-label={card.title}
      style={{ background: `color-mix(in srgb, ${tint} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${tint} 30%, transparent)` }}>
      <div className="row" style={{ gap: 6 }}><Caps color={tint}>{stageTitle(card.stage)}</Caps><Caps>{label}</Caps></div>
      <div className="t-headline">{card.title}</div>
      {card.reason && <div className="muted t-callout">{card.reason}</div>}
      {requesting && <textarea className="text-area" rows={3} autoFocus placeholder="What should change?" value={note} onChange={(e) => setNote(e.target.value)} />}
      {error && <div className="t-caption selectable" style={{ color: "var(--stop)" }}>{error}</div>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{actions}</div>
    </div>
  );
}
