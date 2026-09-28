// Embeds the shared Monaco editor (host.ts) and shows one file in it.

import { useEffect, useRef, useState } from "react";
import { fs } from "../../lib/api";
import { Spinner } from "../../ui";
import { useWorkspace } from "../../state/workspace";
import { host } from "./host";
import { looksBinary } from "./language";

export function MonacoView({ path, onBinary }: { path: string; onBinary?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");

  useEffect(() => {
    let cancelled = false;
    const el = ref.current!;
    (async () => {
      try {
        await host.ensure();
        let text = "";
        if (!host.has(path)) {
          text = await fs.readText(path);
          if (looksBinary(text)) { if (!cancelled) onBinary?.(); return; }
        }
        if (cancelled) return;
        el.appendChild(host.root);
        const ws = useWorkspace.getState();
        const line = ws.pendingReveal[path];
        if (line != null) {
          const { [path]: _, ...rest } = ws.pendingReveal;
          ws.set({ pendingReveal: rest });
        }
        host.open(path, text, line);
        setState("ready");
      } catch (e) {
        if (!cancelled) setState(String(e));
      }
    })();
    return () => {
      cancelled = true;
      host.saveView();
      host.closeDiff();
      if (host.root.parentElement === el) el.removeChild(host.root);
      useWorkspace.getState().set({ cursor: null, language: null });
    };
  }, [path]);

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minHeight: 0 }}>
      {state === "loading" && <div className="empty"><Spinner /></div>}
      {state !== "loading" && state !== "ready" && (
        <div className="empty"><div className="headline">Couldn't open this file</div><div className="caption selectable">{state}</div></div>
      )}
    </div>
  );
}
