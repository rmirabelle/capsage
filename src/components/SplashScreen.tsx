import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { formatShortcut } from "./ShortcutDialog";

const DEFAULT_SHORTCUT = "Ctrl+Alt+PrintScreen";
const SHORTCUT_KEY = "capsage.capture-shortcut";

export function SplashScreen() {
  const [closing, setClosing] = useState(false);
  const shortcut = localStorage.getItem(SHORTCUT_KEY) || DEFAULT_SHORTCUT;

  useEffect(() => {
    const splashWindow = getCurrentWindow();
    const fadeTimer = window.setTimeout(() => setClosing(true), 1950);
    const closeTimer = window.setTimeout(() => {
      void splashWindow.close().catch(() => splashWindow.hide());
    }, 2400);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(closeTimer);
    };
  }, []);

  return (
    <main className={`splash-shell ${closing ? "closing" : ""}`} data-tauri-drag-region>
      <div className="splash-glow" aria-hidden="true" />
      <section className="splash-brand" data-tauri-drag-region>
        <div className="splash-app-icon" data-tauri-drag-region>
          <img src="/icon.ico" alt="" />
        </div>
        <div className="splash-brand-copy" data-tauri-drag-region>
          <h1>CapSage</h1>
          <p>Capture. Annotate. Enlighten.</p>
        </div>
      </section>
      <section className="splash-status" data-tauri-drag-region>
        <i aria-hidden="true" />
        <div data-tauri-drag-region>
          <strong>Ready in your system tray</strong>
          <span>Press {formatShortcut(shortcut)} whenever you’re ready to capture.</span>
        </div>
      </section>
      <div className="splash-progress" aria-hidden="true"><i /></div>
    </main>
  );
}
