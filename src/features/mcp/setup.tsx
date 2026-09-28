// First-launch setup progress (the Mac app's RuntimeStatus view, shown in Settings ▸
// Diagrams and on the start screen while setup runs). Steps come from setup.rs as
// `setup:step` / `setup:state` events; any step id it doesn't know yet (e.g. one the docs
// feature reports for the Python libraries) is shown too.

import { create } from "zustand";
import { useEffect } from "react";
import { CheckCircle2, Circle, TriangleAlert } from "lucide-react";
import { call, listen } from "../../lib/backend";
import { Button, Spinner } from "../../ui";
import { SFSymbol } from "../../ui/icons";

export interface SetupStep { id: string; title: string; state: "pending" | "running" | "done" | "skipped" | "failed"; error?: string | null }
interface Snapshot { running: boolean; ran: boolean; steps: SetupStep[]; log: string[]; needs_core_setup: boolean }

interface SetupStore {
  running: boolean;
  ran: boolean;
  steps: SetupStep[];
  log: string[];
  needsCoreSetup: boolean;
  loaded: boolean;
  load(): Promise<void>;
  /** "Check and repair": runs every step again (only what's missing is installed). */
  repair(): Promise<void>;
}

let subscribed = false;

const merge = (steps: SetupStep[], s: SetupStep) => (steps.some((x) => x.id === s.id) ? steps.map((x) => (x.id === s.id ? s : x)) : [...steps, s]);

export const useSetup = create<SetupStore>((set, get) => ({
  running: false,
  ran: false,
  steps: [],
  log: [],
  needsCoreSetup: false,
  loaded: false,
  async load() {
    if (!subscribed) {
      subscribed = true;
      listen<SetupStep>("setup:step", (s) => set({ steps: merge(get().steps, s), running: get().running || s.state === "running" }));
      listen<Snapshot>("setup:state", (s) => set(applySnap(s, get().steps)));
    }
    set(applySnap(await call<Snapshot>("setup_status"), get().steps));
  },
  async repair() {
    set({ running: true });
    set(applySnap(await call<Snapshot>("setup_start", { force: true }), get().steps));
  },
}));

function applySnap(s: Snapshot, old: SetupStep[]) {
  // Keep extra steps other features reported.
  const extra = old.filter((o) => !s.steps.some((x) => x.id === o.id));
  return { running: s.running, ran: s.ran, steps: [...s.steps, ...extra], log: s.log, needsCoreSetup: s.needs_core_setup, loaded: true };
}

/** One step of RuntimeStatus: `HStack(spacing: 6) { icon; Text(title).font(.caption); why }`. */
export function StepRow({ state, title, error }: { state: SetupStep["state"]; title: string; error?: string | null }) {
  const icon = (name: string, color: string, fb: React.ReactNode) => <SFSymbol name={name} size={13} style={{ color }} fallback={fb} />;
  return (
    <div className="row" style={{ gap: 6, minWidth: 0, minHeight: 16 }}>
      {state === "running" ? <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}><Spinner small /></span>
        : state === "done" || state === "skipped" ? icon("checkmark.circle.fill", "var(--done)", <CheckCircle2 size={13} style={{ color: "var(--done)", flex: "none" }} />)
        : state === "failed" ? icon("exclamationmark.triangle.fill", "var(--warn)", <TriangleAlert size={13} style={{ color: "var(--warn)", flex: "none" }} />)
        : icon("circle", "var(--text-3)", <Circle size={13} className="faint" style={{ flex: "none" }} />)}
      <span style={{ fontSize: 10, lineHeight: "13px", flex: "none" }}>{title}</span>
      {state === "failed" && error && (
        <span title={error} style={{ fontSize: 10, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{error}</span>
      )}
    </div>
  );
}

/** Every setup step with its state, and "Check and repair" when nothing runs
 *  (the Mac app's RuntimeStatus). `extra` rows follow the steps. */
export function SetupPanel({ showRepair = true, extra, onRepair }: { showRepair?: boolean; extra?: React.ReactNode; onRepair?: () => void }) {
  const { steps, running, load, repair } = useSetup();
  useEffect(() => { load().catch(() => {}); }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }} aria-label="Setup">
      {steps.map((step) => <StepRow key={step.id} state={step.state} title={step.title} error={step.error} />)}
      {extra}
      {showRepair && !running && (
        <Button size="small" onClick={() => { repair(); onRepair?.(); }}>Check and repair</Button>
      )}
    </div>
  );
}

/** The start screen's version (the Mac app's EngineStatusView): only while setup runs. */
export function SetupProgress() {
  const { running, load } = useSetup();
  useEffect(() => { load().catch(() => {}); }, []);
  if (!running) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, paddingTop: 4 }}>
      <SetupPanel showRepair={false} />
      <div className="caption">One time only. Everything SPAR needs is set up for you.</div>
    </div>
  );
}
