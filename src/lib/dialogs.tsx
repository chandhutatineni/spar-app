// Promise-based alerts and confirms (the Mac app's NSAlert), rendered by <DialogHost/>.

import { useSyncExternalStore } from "react";

export interface DialogButton { label: string; value: string; kind?: "primary" | "destructive" | "cancel" }
interface Pending { id: number; title: string; message?: string; buttons: DialogButton[]; input?: { value: string; placeholder?: string }; resolve: (v: string | null, input?: string) => void }

let queue: Pending[] = [];
const subs = new Set<() => void>();
let seq = 0;
const emit = () => subs.forEach((s) => s());

export function ask(title: string, message: string | undefined, buttons: DialogButton[]): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, title, message, buttons, resolve: (v) => resolve(v) }];
    emit();
  });
}

export const confirm = async (title: string, message?: string, ok = "OK", destructive = false) =>
  (await ask(title, message, [{ label: "Cancel", value: "cancel", kind: "cancel" }, { label: ok, value: "ok", kind: destructive ? "destructive" : "primary" }])) === "ok";

export const alert = async (title: string, message?: string) => {
  await ask(title, message, [{ label: "OK", value: "ok", kind: "primary" }]);
};

export function promptText(title: string, message?: string, value = "", placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, {
      id: ++seq, title, message, input: { value, placeholder },
      buttons: [{ label: "Cancel", value: "cancel", kind: "cancel" }, { label: "OK", value: "ok", kind: "primary" }],
      resolve: (v, input) => resolve(v === "ok" ? input ?? "" : null),
    }];
    emit();
  });
}

export function DialogHost() {
  const top = useSyncExternalStore((s) => (subs.add(s), () => subs.delete(s)), () => queue[0]);
  if (!top) return null;
  let input = top.input?.value ?? "";
  const done = (v: string | null) => {
    queue = queue.slice(1);
    emit();
    top.resolve(v, input);
  };
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && done("cancel")}>
      <div className="modal dialog" role="alertdialog" aria-label={top.title}>
        <div className="dialog-title">{top.title}</div>
        {top.message && <div className="dialog-message">{top.message}</div>}
        {top.input && (
          <input className="text-field" autoFocus defaultValue={top.input.value} placeholder={top.input.placeholder}
            onChange={(e) => (input = e.target.value)} onKeyDown={(e) => e.key === "Enter" && done("ok")} />
        )}
        <div className="dialog-buttons">
          {top.buttons.map((b) => (
            <button key={b.value} autoFocus={!top.input && b.kind === "primary"} className={`btn ${b.kind === "primary" ? "btn-primary" : b.kind === "destructive" ? "btn-danger" : ""}`} onClick={() => done(b.value)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
