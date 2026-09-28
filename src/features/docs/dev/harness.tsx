// Development-only page (not part of the app build): the docs views on their own, through the
// dev bridge at /src/features/docs/dev/harness.html?view=md|diagram|new&path=<file>.
import ReactDOM from "react-dom/client";
import "../../../theme.css";
import { DocumentView, MarkdownView, NewDiagramSheet } from "..";
import { DialogHost } from "../../../lib/dialogs";
import { MenuHost } from "../../../ui";
import { useWorkspace } from "../../../state/workspace";

const SAMPLE = "# Title\n\nSome **bold** and `code` text in a paragraph that wraps onto a second line for spacing.\n\n## Section\n\n- [x] done item\n- [ ] open item\n1. first\n2. second\n\n> a quote\n\n| A | B |\n|---|---|\n| one | two |\n| three | four |\n\n```\nconst x = 1;\n```\n";
const q = new URLSearchParams(location.search);
const path = q.get("path") ?? "";
if (q.get("root")) useWorkspace.setState({ root: q.get("root")! } as never);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
    {q.get("view") === "mdview" ? <div style={{ padding: 24, maxWidth: 560 }}><MarkdownView text={SAMPLE} /></div> : q.get("view") === "new" ? <NewDiagramSheet onClose={() => {}} /> : <DocumentView path={path} showSource={q.get("source") !== "0"} />}
    <DialogHost />
    <MenuHost />
  </div>,
);
