// Public surface of the insights feature: Traceability (requirement → spec → task → code →
// test) and AI Impact (adoption, output, rework, delivery, spend, ROI) pages, plus the Jira
// tracker logic other features use.
//
// For the chat feature (the Mac app's Workspace.decide): after a gate decision succeeds,
//   if (tracker.afterApproval(gate, approve)) return null;   // sent the Jira export turn
// before "continue after approval". `useIssues()` gives the feature's tracker keys (ws.issues)
// and <IssueBadge issue={…}/> shows one next to a task.

import * as trackerFns from "./tracker";

export { TraceView, IssueBadge } from "./TraceView";
export { ImpactView } from "./ImpactView";
export { JiraSettings } from "./JiraSettings";
export { useIssues, useJiraBlocker, jiraSettings, JIRA_KEYS, type TrackerIssue } from "./tracker";
export { loadTrace, type Trace } from "./trace";
export { loadImpact, runImpact, type ImpactReport } from "./impact";

/** The Mac app's `Tracker` enum and the Workspace's Jira calls. */
export const tracker = {
  server: trackerFns.server,
  site: trackerFns.site,
  projectKey: trackerFns.projectKey,
  autoExport: () => trackerFns.jiraSettings.autoExport(),
  issues: trackerFns.loadIssues,
  browse: trackerFns.browse,
  open: trackerFns.openIssue,
  exportRequest: trackerFns.exportRequest,
  blocker: trackerFns.jiraBlocker,
  exportToJira: trackerFns.exportToJira,
  afterApproval: trackerFns.afterApproval,
};
