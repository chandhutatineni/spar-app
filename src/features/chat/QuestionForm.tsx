// Questions an agent asks in a ```spar-questions block, shown like Claude Code's picker: each
// question with its options (the recommended one first), room for your own answer, and one
// Submit that sends all the answers back (QuestionForm.swift). Works the same for every agent.

import { useState } from "react";
import { CheckCircle2, Circle, CircleDot, Send, Square, SquareCheck } from "lucide-react";
import { Button } from "../../ui";
import { isRunning, markAnswered, send, useChat } from "../../state/chat";
import type { AgentQuestion } from "./questions";
import { SFSymbol } from "../../ui/icons";

export function QuestionForm({ entryId, questions, answeredLater }: { entryId: string; questions: AgentQuestion[]; answeredLater: boolean }) {
  const running = useChat(isRunning);
  const answered = useChat((s) => s.answered.includes(entryId));
  // Start from the recommendations, so a quick look and Submit is enough.
  const [picked, setPicked] = useState<Record<string, number[]>>(() => Object.fromEntries(
    questions.filter((q) => q.recommended != null && q.recommended < q.options.length).map((q) => [q.id, [q.recommended!]])));
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [sentNow, setSentNow] = useState(false);
  const sent = sentNow || answered || answeredLater;

  const isPicked = (q: AgentQuestion, i: number) => picked[q.id]?.includes(i) ?? false;
  const toggle = (q: AgentQuestion, i: number) => {
    setCustom((c) => ({ ...c, [q.id]: "" }));
    setPicked((p) => {
      if (!q.multi) return { ...p, [q.id]: [i] };
      const s = new Set(p[q.id] ?? []);
      if (s.has(i)) s.delete(i); else s.add(i);
      return { ...p, [q.id]: [...s] };
    });
  };
  const complete = (pk = picked, cu = custom) => questions.every((q) => (pk[q.id] ?? []).length > 0 || (cu[q.id] ?? "").trim() !== "");

  const submit = (pk = picked, cu = custom) => {
    if (!complete(pk, cu) || sent) return;
    const lines = questions.map((q, n) => {
      const own = (cu[q.id] ?? "").trim();
      const ans = own || [...(pk[q.id] ?? [])].sort((a, b) => a - b).map((i) => q.options[i].label).join(", ");
      return `${n + 1}. ${q.question} → ${ans}`;
    });
    setSentNow(true);
    markAnswered(entryId);
    send("My answers: " + lines.join(" · "));
  };

  const useRecommendations = () => {
    const pk = { ...picked };
    const cu = { ...custom };
    for (const q of questions) if (q.recommended != null && q.recommended < q.options.length) { pk[q.id] = [q.recommended]; cu[q.id] = ""; }
    setPicked(pk);
    setCustom(cu);
    submit(pk, cu);
  };

  return (
    <div className="col qf" style={{ gap: 14, padding: 14, borderRadius: 12, background: "color-mix(in srgb, var(--subtle) 60%, transparent)" }} aria-label="Questions">
      {questions.map((q, n) => (
        <div key={q.id} className="col" style={{ gap: 7 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>{n + 1}. {q.question}</div>
          {q.options.map((o, i) => (
            <button key={i} type="button" className="qf-option" disabled={sent} onClick={() => toggle(q, i)} role={q.multi ? "checkbox" : "radio"} aria-checked={isPicked(q, i)}>
              <span style={{ color: isPicked(q, i) ? "var(--accent)" : "var(--text-2)", paddingTop: 1, display: "inline-flex" }}>
                {q.multi
                  ? (isPicked(q, i) ? <SFSymbol name="checkmark.square.fill" size={13} fallback={<SquareCheck size={15} />} /> : <SFSymbol name="square" size={13} fallback={<Square size={15} />} />)
                  : (isPicked(q, i) ? <SFSymbol name="largecircle.fill.circle" size={13} fallback={<CircleDot size={15} />} /> : <SFSymbol name="circle" size={13} fallback={<Circle size={15} />} />)}
              </span>
              <span className="col" style={{ gap: 1 }}>
                <span className="row" style={{ gap: 6 }}>
                  <span style={{ fontSize: 12 }}>{o.label}</span>
                  {q.recommended === i && <span className="qf-rec">Recommended</span>}
                </span>
                {o.detail && <span className="t-caption muted">{o.detail}</span>}
              </span>
            </button>
          ))}
          <input className="text-field" style={{ fontSize: 12, height: 22 }} placeholder="Or type your own answer" disabled={sent} value={custom[q.id] ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setCustom((c) => ({ ...c, [q.id]: v }));
              if (v) setPicked((p) => ({ ...p, [q.id]: [] }));
            }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        </div>
      ))}
      <div className="row">
        {sent ? (
          <span className="row muted" style={{ gap: 5, fontSize: 12 }}><SFSymbol name="checkmark.circle.fill" size={12} fallback={<CheckCircle2 size={14} />} /> Answers sent</span>
        ) : (
          <>
            <Button size="small" onClick={useRecommendations} disabled={questions.every((q) => q.recommended == null)}>Use all recommendations</Button>
            <span className="spacer" />
            <Button size="small" kind="primary" icon={<SFSymbol name="paperplane.fill" size={11} fallback={<Send size={12} />} />} onClick={() => submit()} disabled={!complete() || running}>Submit answers</Button>
          </>
        )}
      </div>
    </div>
  );
}
