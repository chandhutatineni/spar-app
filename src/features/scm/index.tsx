// Public surface of the source-control feature: git sidebar, source control page, review,
// diffs, status bar, GitHub connect — plus the store and checkpoints for the chat feature.

import "./scm.css";

export { GitSidebar } from "./GitSidebar";
export { StatusBar } from "./StatusBar";
export { SourceControlView } from "./SourceControlView";
export { ReviewView } from "./ReviewView";
/** Diff of a workspace-relative path (Doc kind "diff"). */
export { DiffView } from "./DiffView";
/** Connect-to-GitHub control (browser sign-in or token), used by Settings too. */
export { GitHubConnect, GitHubConnectSheet } from "./GitHubConnect";

// For other features (chat: checkpoints before each message, "restore to here", the review):
export { checkpoints } from "./api";
export { useScm, refresh as refreshSourceControl, openReview, loadReview, restoreCheckpoint, undoRestore } from "./store";
export { useGitHubUser, githubUser } from "./github";
