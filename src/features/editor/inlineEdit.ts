// ⌘K inline edits (InlineEdit in Composer.swift). The chat feature owns the edit itself
// (send to the agent, wait for the turn, accept / reject: state/chat.ts); the editor owns
// the prompt bar (`cmdK`), the inline diff and the review bar.

import { create } from "zustand";
import {
  acceptInlineEdit as chatAccept, rejectInlineEdit as chatReject, startInlineEdit as chatStart, useChat,
} from "../chat";

export interface CmdK { path: string; lines: [number, number]; selection: string; full: string }
export interface InlineEdit { path: string; original: string; lines: [number, number]; state: "waiting" | "review" }

interface InlineStore {
  cmdK: CmdK | null;
  /** A short message shown over the file. */
  notice: string | null;
}

export const useInline = create<InlineStore>(() => ({ cmdK: null, notice: null }));

/** The inline edit on this file, if any (from the chat's state). */
export function useInlineEdit(path: string): InlineEdit | null {
  const e = useChat((s) => (s.inlineEdit?.path === path ? s.inlineEdit : null));
  return e ? { path: e.path, original: e.original, lines: [e.from, e.to], state: e.state } : null;
}

export function startInlineEdit(path: string, text: string, lines: [number, number], selection: string, instruction: string) {
  useInline.setState({ cmdK: null, notice: null });
  chatStart(path, text, lines[0], lines[1], selection, instruction);
}

export const acceptInlineEdit = () => chatAccept();
export const rejectInlineEdit = () => chatReject();
