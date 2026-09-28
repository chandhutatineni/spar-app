// Development-only page (not part of the app build): the MCP servers page on its own, for
// testing through the dev bridge at /src/features/mcp/dev/harness.html.
import ReactDOM from "react-dom/client";
import "../../../theme.css";
import { MCPView } from "../MCPView";
import { SetupProgress } from "../setup";
import { DialogHost } from "../../../lib/dialogs";
import { MenuHost } from "../../../ui";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100%" }}>
    <SetupProgress />
    <MCPView agent={{ title: "Codex", family: "codex" }} />
    <DialogHost />
    <MenuHost />
  </div>,
);
