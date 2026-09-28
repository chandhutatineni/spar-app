// SwiftUI's grouped Form on macOS (Settings window): sections with a bold header over a
// rounded card, rows with the label on the left and the control on the right, separators
// between rows, captions. Styles in form.css.

import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { SFSymbol } from "../../ui/icons";
import "./form.css";

export function FormPage({ children }: { children: ReactNode }) {
  return <div className="gf"><div className="gf-page">{children}</div></div>;
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gf-section" aria-label={title}>
      <div className="gf-header">{title}</div>
      <div className="gf-card">{children}</div>
    </section>
  );
}

/** A row: `label` on the left, `children` (the control) on the right. */
export function FormRow({ label, children, help, top }: { label?: ReactNode; children?: ReactNode; help?: string; top?: boolean }) {
  return (
    <div className={`gf-row settings-row ${top ? "top" : ""}`} title={help}>
      {label !== undefined && <span className="gf-label">{label}</span>}
      {children}
    </div>
  );
}

/** A free-form row (a VStack in a Form section). */
export const FormBlock = ({ children }: { children: ReactNode }) => <div className="gf-block">{children}</div>;

/** `Text(...).font(.caption).foregroundStyle(.secondary)` as a row of its own. */
export const FormCaption = ({ children }: { children: ReactNode }) => <div className="gf-caption">{children}</div>;

/** `LabeledContent(label, value:)`: the value in secondary text. */
export const FormValue = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <FormRow label={label}><span className="gf-value selectable">{children}</span></FormRow>
);

/** A switch (`.toggleStyle(.switch)`); `tinted` in the main window (SPAR's accent, not the system's). */
export function FormSwitch({ on, onChange, disabled, label, tinted }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; tinted?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`gf-switch ${on ? "on" : ""} ${tinted ? "tinted" : ""}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function FormToggle({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <FormRow label={label}><FormSwitch on={on} onChange={onChange} disabled={disabled} label={label} /></FormRow>;
}

export function FormStepper({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const name = label.split(":")[0];
  return (
    <FormRow label={label}>
      <span className="gf-stepper" role="group" aria-label={label}>
        <button type="button" aria-label={`Increase ${name}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
          <SFSymbol name="chevron.up" size={12} weight="semibold" fallback={<ChevronUp size={11} />} />
        </button>
        <button type="button" aria-label={`Decrease ${name}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
          <SFSymbol name="chevron.down" size={12} weight="semibold" fallback={<ChevronDown size={11} />} />
        </button>
      </span>
    </FormRow>
  );
}

export function FormSegmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <FormRow label={label}>
      <div className="gf-seg" role="tablist" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </FormRow>
  );
}

/** `Picker` (menu style): the value and a round ⌃⌄ badge; clicking opens the native menu. */
export function FormPicker<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <FormRow label={label}>
      <span className="gf-menu">
        <span>{current}</span>
        <span className="badge"><SFSymbol name="chevron.up.chevron.down" size={10} weight="semibold" fallback={<ChevronsUpDown size={11} />} /></span>
        <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </span>
    </FormRow>
  );
}

/** `TextField(label, text:, prompt:)`: the label on the left, the text right-aligned. */
export function FormTextField({ label, value, onChange, prompt, help }: { label: string; value: string; onChange: (v: string) => void; prompt?: string; help?: string }) {
  return (
    <label className="gf-row settings-row" title={help}>
      <span className="gf-label">{label}</span>
      <input className="gf-field" value={value} placeholder={prompt} aria-label={label} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A bordered form button (`.controlSize(.small)` with `small`). */
export const FormButton = ({ children, onClick, small, disabled, title }: { children: ReactNode; onClick?: () => void; small?: boolean; disabled?: boolean; title?: string }) => (
  <button type="button" className={`gf-btn ${small ? "small" : ""}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>
);

/** `.buttonStyle(.link)`. */
export const FormLink = ({ children, onClick, style }: { children: ReactNode; onClick?: () => void; style?: CSSProperties }) => (
  <button type="button" className="gf-link" onClick={onClick} style={style}>{children}</button>
);
