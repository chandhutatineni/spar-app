// Settings › Terminal (the Mac app's SettingsView "Terminal" section in SPARApp.swift).
// Changes apply to open terminals at once; the shell applies to new terminals.

import type { CSSProperties, ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { usePref } from "../../lib/prefs";
import { IconButton, Segmented, Toggle } from "../../ui";
import { TERMINAL_DEFAULTS } from "./terminals";

const field: CSSProperties = { height: 24, padding: "0 8px", borderRadius: 6, border: "0.5px solid var(--hairline-strong)", background: "var(--field)", minWidth: 0, width: 260 };

function Stepper({ label, value, onChange, min, max, step }: { label: ReactNode; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span>{label}</span>
      <span className="row" style={{ gap: 2 }}>
        <IconButton size={22} icon={<Minus size={12} />} title="Decrease" disabled={value <= min} onClick={() => onChange(clamp(value - step))} />
        <IconButton size={22} icon={<Plus size={12} />} title="Increase" disabled={value >= max} onClick={() => onChange(clamp(value + step))} />
      </span>
    </div>
  );
}

export function TerminalSettings() {
  const d = TERMINAL_DEFAULTS;
  const [size, setSize] = usePref("terminalFontSize", d.terminalFontSize);
  const [font, setFont] = usePref("terminalFontFamily", d.terminalFontFamily);
  const [shell, setShell] = usePref("terminalShell", d.terminalShell);
  const [cursor, setCursor] = usePref<"block" | "underline" | "bar">("terminalCursorStyle", d.terminalCursorStyle);
  const [blink, setBlink] = usePref("terminalCursorBlink", d.terminalCursorBlink);
  const [scrollback, setScrollback] = usePref("terminalScrollback", d.terminalScrollback);
  return (
    <div data-testid="terminal-settings" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Stepper label={`Font size: ${Number(size).toFixed(1)} pt`} value={Number(size)} onChange={setSize} min={9} max={24} step={0.5} />
      <input style={field} value={font} placeholder="Font family (empty = SF Mono)" aria-label="Font family" onChange={(e) => setFont(e.target.value)} />
      <input style={field} value={shell} placeholder="Shell (empty = your login shell)" aria-label="Shell" onChange={(e) => setShell(e.target.value)}
        title="For example /bin/zsh, /bin/bash, /opt/homebrew/bin/fish. Applies to new terminals." />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>Cursor</span>
        <Segmented value={cursor} onChange={setCursor} options={[{ value: "block", label: "Block" }, { value: "bar", label: "Bar" }, { value: "underline", label: "Underline" }]} />
      </div>
      <Toggle label="Blinking cursor" on={blink} onChange={setBlink} />
      <Stepper label={`Scrollback: ${scrollback} lines`} value={Number(scrollback)} onChange={setScrollback} min={1000} max={100000} step={1000} />
    </div>
  );
}
