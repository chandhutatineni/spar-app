// Public surface of the MCP/settings feature: MCP servers page, Settings window, first-run runtime.

import { registerCommand } from "../../lib/commands";
import { useWorkspace } from "../../state/workspace";

export { SettingsView } from "./SettingsView";
export { MCPView, MCPServerEditor, MCPJSONEditor, type MCPViewProps } from "./MCPView";
export { SetupPanel, SetupProgress, useSetup, type SetupStep } from "./setup";
/** The Mac app's name for the setup steps view. */
export { SetupPanel as RuntimeStatus } from "./setup";
export { useMCP, useReadyCount, mcpConfigPath, githubAccountChanged } from "./store";
export type { MCPServer, MCPStatus } from "./mcpJson";

// Opens the MCP servers tab in a project window (palette, and Settings ▸ Manage MCP servers…,
// which reaches every window as the `menu` event {id: "show-mcp"}).
registerCommand("show-mcp", {
  title: "MCP Servers",
  group: "View",
  enabled: () => !!useWorkspace.getState().root,
  run: () => useWorkspace.getState().open({ kind: "mcp" }),
});
