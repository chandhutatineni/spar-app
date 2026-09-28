import { useEffect, useState } from "react";
import { MainView } from "./layout/MainView";
import { useApp, initialProject } from "./state/app";
import { bootEngine } from "./engine/engine";
import { hookMenu, useCommand } from "./lib/commands";
import { usePref } from "./lib/prefs";
import { DialogHost } from "./lib/dialogs";
import { MenuHost } from "./ui";
import { WelcomeView } from "./features/welcome";
import { SettingsView } from "./features/mcp";

/** Applies the "appearance" preference (light / dark / system) to <html>. */
function useAppearance() {
  const [appearance, setAppearance] = usePref<"light" | "dark" | "system">("appearance", "system");
  useEffect(() => {
    if (appearance === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", appearance);
  }, [appearance]);
  useCommand("appearance-light", { title: "Appearance: Light", group: "View", run: () => setAppearance("light") });
  useCommand("appearance-dark", { title: "Appearance: Dark", group: "View", run: () => setAppearance("dark") });
  useCommand("appearance-system", { title: "Appearance: Match System", group: "View", run: () => setAppearance("system") });
}

export default function App() {
  const route = location.hash.startsWith("#settings") ? "settings" : "main";
  useAppearance();
  useEffect(() => hookMenu(), []);
  return (
    <>
      {route === "settings" ? <SettingsView /> : <ProjectWindow />}
      <DialogHost />
      <MenuHost />
    </>
  );
}

function ProjectWindow() {
  const project = useApp((s) => s.project);
  const openProject = useApp((s) => s.openProject);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    bootEngine().catch(() => {});
    initialProject().then(async (p) => {
      if (p) await openProject(p).catch(() => {});
      setReady(true);
    });
  }, []);
  // File ▸ Open Recent items arrive as `recent:<path>`.
  useEffect(() => {
    import("./lib/backend").then(({ listen }) =>
      listen<{ id: string }>("menu", ({ id }) => { if (id.startsWith("recent:")) openProject(id.slice(7)); }));
  }, []);
  if (!ready) return null;
  return project ? <MainView key={project} /> : <WelcomeView />;
}
