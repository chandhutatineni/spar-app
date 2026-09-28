// Public surface of the editor feature: tabs + Monaco, explorer, search, palette, rules,
// welcome tab. Other features can plug in via `provideEditorIntegration` (see integration.ts).

import { onProjectOpen } from "../../state/app";
import { prefs } from "../../lib/prefs";
import { useWorkspace, sameDoc, type Doc } from "../../state/workspace";
import "./explorerStore";
import "./wireChat";

export { EditorArea } from "./EditorArea";
export { Explorer } from "./Explorer";
export { SearchView } from "./SearchView";
export { Palette } from "./Palette";
export { RulesView } from "./RulesView";
export { WelcomeTab } from "./WelcomeTab";
export { provideEditorIntegration, useIntegration, type EditorIntegration, type ContextChip } from "./integration";
export { startInlineEdit, useInline } from "./inlineEdit";
export { loadRules, ruleApplies, matchGlob, ruleName, type ProjectRule } from "./rules";
export { languageFor } from "./language";
export { host as editorHost } from "./host";

// A project opens with the Welcome tab (unless turned off), like the Mac app.
onProjectOpen(() => {
  const ws = useWorkspace.getState();
  if (prefs.get("showWelcomeOnOpen", true) && ws.workflowMode) {
    ws.set({ tabs: [...ws.tabs.filter((t) => t.kind !== "welcome"), { kind: "welcome" }], activeTab: { kind: "welcome" } });
  }
});

// Tabs follow the agent's mode: phase pages only while the SPAR workflow runs (applyMode).
useWorkspace.subscribe((s, prev) => {
  if (s.workflowMode === prev.workflowMode) return;
  const phase: Doc = { kind: "phase" }, welcome: Doc = { kind: "welcome" };
  if (s.workflowMode) {
    if (!s.tabs.some((t) => sameDoc(t, phase))) s.set({ tabs: [phase, ...s.tabs] });
  } else {
    let tabs = s.tabs.filter((t) => !sameDoc(t, phase));
    if (!tabs.some((t) => sameDoc(t, welcome))) tabs = [welcome, ...tabs];
    s.set({
      tabs,
      activeTab: sameDoc(s.activeTab, phase) ? welcome : s.activeTab,
      sidebarMode: s.sidebarMode === "work" ? "files" : s.sidebarMode,
    });
  }
});

// Git branch and changes from the source-control feature (explorer badges, welcome header).
import { useScm } from "../scm";
import { provideEditorIntegration as provide } from "./integration";
const syncScm = (s: ReturnType<typeof useScm.getState>) =>
  provide({ branch: s.branch, changes: s.isRepo ? s.changes : undefined });
syncScm(useScm.getState());
useScm.subscribe(syncScm);
