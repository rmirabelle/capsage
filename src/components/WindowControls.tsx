import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const appWindow = isTauri() ? getCurrentWindow() : null;

  useEffect(() => {
    if (!appWindow) return;
    appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(() => appWindow.isMaximized().then(setMaximized));
    return () => void unlisten.then((stop) => stop());
  }, [appWindow]);

  return (
    <div className="window-controls">
      <button aria-label="Minimize to tray" title="Minimize to tray" onClick={() => appWindow?.hide()}>
        <svg viewBox="0 0 10 10"><path d="M.5 5h9" /></svg>
      </button>
      <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => appWindow?.toggleMaximize()}>
        {maximized ? (
          <svg viewBox="0 0 10 10"><rect x=".5" y="2.5" width="7" height="7" /><path d="M2.5 2.5v-2h7v7h-2" /></svg>
        ) : (
          <svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" /></svg>
        )}
      </button>
      <button className="window-close" aria-label="Close" onClick={() => appWindow?.close()}>
        <svg viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
      </button>
    </div>
  );
}
