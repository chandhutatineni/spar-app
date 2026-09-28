// Shared UI primitives in the Mac app's style. Icons: lucide-react.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties, type MouseEvent as RME } from "react";
import { Check, ChevronRight } from "lucide-react";

export function Button(p: {
  children?: ReactNode; onClick?: (e: RME) => void; kind?: "default" | "primary" | "danger" | "plain"; size?: "small" | "regular" | "large";
  disabled?: boolean; title?: string; icon?: ReactNode; className?: string; style?: CSSProperties; type?: "button" | "submit"; autoFocus?: boolean;
}) {
  const cls = ["btn", p.kind === "primary" && "btn-primary", p.kind === "danger" && "btn-danger", p.kind === "plain" && "btn-plain", p.size === "small" && "btn-small", p.size === "large" && "btn-large", p.className].filter(Boolean).join(" ");
  return (
    <button type={p.type ?? "button"} className={cls} onClick={p.onClick} disabled={p.disabled} title={p.title} style={p.style} autoFocus={p.autoFocus}>
      {p.icon}
      {p.children}
    </button>
  );
}

export function IconButton(p: { icon: ReactNode; onClick?: (e: RME) => void; title?: string; disabled?: boolean; active?: boolean; size?: number; className?: string }) {
  return (
    <button type="button" className={`icon-btn ${p.active ? "active" : ""} ${p.className ?? ""}`} onClick={p.onClick} title={p.title} aria-label={p.title} disabled={p.disabled} style={p.size ? { width: p.size, height: p.size } : undefined}>
      {p.icon}
    </button>
  );
}

export const Spinner = ({ small }: { small?: boolean }) => <span className={`spinner ${small ? "small" : ""}`} role="progressbar" />;

export function StatusDot({ status }: { status: string }) {
  const color = status === "running" || status === "waiting" ? "var(--accent)" : status === "idle" ? "var(--done)" : status === "failed" || status === "offline" ? "var(--stop)" : "var(--text-3)";
  return <span className="status-dot" style={{ background: color, animation: status === "running" ? "pulse 1.2s ease-in-out infinite" : undefined }} />;
}

/** The SPAR mark: the app icon, so the brand is the same everywhere. */
export const Mark = ({ size = 28 }: { size?: number }) => <img src="/spar.png" width={size} height={size} alt="" style={{ flex: "none" }} draggable={false} />;

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode }) {
  const sw = <button type="button" role="switch" aria-checked={on} className={`switch ${on ? "on" : ""}`} disabled={disabled} onClick={() => onChange(!on)} />;
  if (!label) return sw;
  return (
    <label className="row" style={{ justifyContent: "space-between", opacity: disabled ? 0.5 : 1 }}>
      <span>{label}</span>
      {sw}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A modal sheet. Escape and a click outside close it (unless `modal`). */
export function Sheet({ onClose, children, width = 520, modal, label }: { onClose: () => void; children: ReactNode; width?: number; modal?: boolean; label?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !modal && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, modal]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !modal && onClose()}>
      <div className="modal sheet" role="dialog" aria-label={label} style={{ width }}>{children}</div>
    </div>
  );
}

// ---- Menus ----------------------------------------------------------------------------

export type MenuEntry =
  | { label: ReactNode; onClick?: () => void; disabled?: boolean; checked?: boolean; shortcut?: string; detail?: ReactNode; icon?: ReactNode; submenu?: MenuEntry[] }
  | { section: string }
  | "divider";

function MenuList({ items, x, y, onClose }: { items: MenuEntry[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 6)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) });
  }, [x, y]);
  const hasChecks = items.some((i) => typeof i === "object" && "label" in i && i.checked !== undefined);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) => {
        if (it === "divider") return <div key={i} className="menu-divider" />;
        if ("section" in it) return <div key={i} className="menu-section">{it.section}</div>;
        return (
          <div key={i} role="menuitem" className={`menu-item ${it.disabled ? "disabled" : ""}`}
            onMouseEnter={(e) => {
              if (it.submenu) { const r = e.currentTarget.getBoundingClientRect(); setSub({ i, x: r.right - 2, y: r.top - 5 }); } else setSub(null);
            }}
            onClick={() => { if (it.disabled || it.submenu) return; onClose(); it.onClick?.(); }}>
            {hasChecks && <span className="menu-check">{it.checked && <Check size={13} />}</span>}
            {it.icon}
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span>{it.label}</span>
              {it.detail && <span className="menu-detail">{it.detail}</span>}
            </span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
            {it.submenu && <ChevronRight size={13} style={{ marginLeft: "auto" }} />}
          </div>
        );
      })}
      {sub && typeof items[sub.i] === "object" && "submenu" in (items[sub.i] as object) && (
        <MenuList items={(items[sub.i] as { submenu: MenuEntry[] }).submenu} x={sub.x} y={sub.y} onClose={onClose} />
      )}
    </div>
  );
}

let openMenu: ((m: { items: MenuEntry[]; x: number; y: number } | null) => void) | null = null;

/** Shows a menu at a point (context menus) or under an element. */
export function showMenu(items: MenuEntry[], at: { x: number; y: number } | HTMLElement) {
  const p = at instanceof HTMLElement ? (() => { const r = at.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; })() : at;
  openMenu?.({ items, ...p });
}

export function MenuHost() {
  const [m, setM] = useState<{ items: MenuEntry[]; x: number; y: number } | null>(null);
  useEffect(() => {
    openMenu = setM;
    const close = () => setM(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", k); };
  }, []);
  return m ? <MenuList items={m.items} x={m.x} y={m.y} onClose={() => setM(null)} /> : null;
}

/** A button that opens a dropdown menu. */
export function MenuButton({ items, children, className, title, disabled }: { items: MenuEntry[] | (() => MenuEntry[]); children: ReactNode; className?: string; title?: string; disabled?: boolean }) {
  return (
    <button type="button" className={className ?? "btn btn-plain"} title={title} disabled={disabled} data-menu=""
      onMouseDown={(e) => { e.stopPropagation(); showMenu(typeof items === "function" ? items() : items, e.currentTarget); }}>
      {children}
    </button>
  );
}

/** Right-click handler: `onContextMenu={contextMenu(() => [...])}` */
export const contextMenu = (items: () => MenuEntry[]) => (e: RME) => {
  e.preventDefault();
  e.stopPropagation();
  showMenu(items(), { x: e.clientX, y: e.clientY });
};

/** A vertical drag handle that resizes a neighbour (`dir` = 1 grows to the right). */
export function SplitHandle({ value, onChange, min, max, dir = 1, onReset, vertical }: { value: number; onChange: (v: number) => void; min: number; max: number; dir?: 1 | -1; onReset?: () => void; vertical?: boolean }) {
  const start = useRef<{ p: number; v: number } | null>(null);
  return (
    <div
      onDoubleClick={onReset}
      onMouseDown={(e) => {
        start.current = { p: vertical ? e.clientY : e.clientX, v: value };
        const move = (ev: MouseEvent) => {
          if (!start.current) return;
          const d = (vertical ? ev.clientY : ev.clientX) - start.current.p;
          onChange(Math.min(max, Math.max(min, start.current.v + d * dir)));
        };
        const up = () => { start.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        document.body.style.cursor = vertical ? "row-resize" : "col-resize";
      }}
      style={vertical
        ? { height: 5, margin: "-2px 0", cursor: "row-resize", position: "relative", zIndex: 5, flex: "none", background: "linear-gradient(transparent 2px, var(--hairline-strong) 2px, var(--hairline-strong) 3px, transparent 3px)" }
        : { width: 5, margin: "0 -2px", cursor: "col-resize", position: "relative", zIndex: 5, flex: "none", background: "linear-gradient(90deg, transparent 2px, var(--hairline-strong) 2px, var(--hairline-strong) 3px, transparent 3px)" }}
    />
  );
}
