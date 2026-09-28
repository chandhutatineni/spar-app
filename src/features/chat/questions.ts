// Questions an agent asks in a ```spar-questions block (QuestionBlock in QuestionForm.swift).

import { QUESTION_FENCE } from "./transcript";

export interface QuestionOption { label: string; detail: string | null }
export interface AgentQuestion { id: string; question: string; options: QuestionOption[]; recommended: number | null; multi: boolean }

function decodeQuestion(o: any): AgentQuestion | null {
  if (!o || typeof o.question !== "string") return null;
  const options: QuestionOption[] = Array.isArray(o.options)
    ? o.options.map((x: any) => (typeof x === "string" ? { label: x, detail: null } : x && typeof x.label === "string" ? { label: x.label, detail: typeof x.detail === "string" ? x.detail : null } : null)).filter(Boolean)
    : [];
  return {
    id: typeof o.id === "string" ? o.id : o.question,
    question: o.question,
    options,
    recommended: Number.isInteger(o.recommended) ? o.recommended : null,
    multi: o.multi === true,
  };
}

/** Splits a reply into the text around the block and the questions in it. */
export function parseQuestions(text: string): { before: string; questions: AgentQuestion[]; after: string } | null {
  const start = text.indexOf(QUESTION_FENCE);
  if (start < 0) return null;
  const rest = text.slice(start + QUESTION_FENCE.length);
  const end = rest.indexOf("```");
  if (end < 0) return null;
  let parsed: any;
  try { parsed = JSON.parse(rest.slice(0, end).trim()); } catch { return null; }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : null;
  if (!list) return null;
  const questions = list.map(decodeQuestion);
  if (!questions.length || questions.some((q: AgentQuestion | null) => q == null)) return null;
  return { before: text.slice(0, start).trim(), questions, after: rest.slice(end + 3).trim() };
}
