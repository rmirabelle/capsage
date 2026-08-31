import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Camera,
  CheckCircle,
  Crop,
  Desktop,
  Keyboard,
  PencilSimple,
  SpinnerGap,
  WarningCircle
} from "@phosphor-icons/react";
import { Editor } from "./components/Editor";
import { AboutDialog } from "./components/AboutDialog";
import { CaptureStyleToolbar } from "./components/CaptureStyleToolbar";
import { formatShortcut, ShortcutDialog, shortcutTokens } from "./components/ShortcutDialog";
import { TitleBar } from "./components/TitleBar";
import { DEFAULT_CAPTURE_STYLE, type CaptureStyle } from "./editor/style";
import type { CaptureMode, CaptureResult } from "./editor/types";
import { checkForUpdate, getAppVersion, type UpdateInfo } from "./lib/updater";

const DEFAULT_SHORTCUT = "Ctrl+Alt+PrintScreen";
const MODE_KEY = "capsage.capture-mode";
const SHORTCUT_KEY = "capsage.capture-shortcut";
const SAVE_SEQUENCE_KEY = "capsage.save-sequence";

type Stage = "empty" | "edit";
type Notice = { tone: "success" | "error"; message: string } | null;
type ShortcutStatus = { registered: boolean; shortcut: string; error: string | null };

export default function App() {
  const initialMode = localStorage.getItem(MODE_KEY) === "region" ? "region" : "window";
  const initialShortcut = localStorage.getItem(SHORTCUT_KEY) || DEFAULT_SHORTCUT;
  const [mode, setModeState] = useState<CaptureMode>(initialMode);
  const modeRef = useRef(mode);
  const capturingRef = useRef(false);
  const shortcutDialogOpenRef = useRef(false);
  const [stage, setStage] = useState<Stage>("empty");
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [captureSession, setCaptureSession] = useState(0);
  const [captureStyle, setCaptureStyle] = useState<CaptureStyle>({ ...DEFAULT_CAPTURE_STYLE });
  const [capturing, setCapturing] = useState(false);
  const [shortcutReady, setShortcutReady] = useState(false);
  const [shortcut, setShortcut] = useState(initialShortcut);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [startupUpdate, setStartupUpdate] = useState<UpdateInfo | null>(null);

  const setMode = (next: CaptureMode) => {
    modeRef.current = next;
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
  };

  const showNotice = useCallback((next: Notice) => {
    setNotice(next);
    if (next?.tone === "success") window.setTimeout(() => setNotice(null), 3200);
  }, []);

  const restoreMainWindow = useCallback(async () => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    try { await appWindow.show(); } catch { /* Best-effort recovery. */ }
    try { await appWindow.unminimize(); } catch { /* The window may not be minimized. */ }
    try { await appWindow.setFocus(); } catch { /* Windows can deny foreground focus. */ }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    getAppVersion()
      .then((version) => { if (!cancelled) setAppVersion(version); })
      .catch(() => {});
    checkForUpdate()
      .then((info) => { if (!cancelled && info) setStartupUpdate(info); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const performCapture = useCallback(async (captureMode: CaptureMode) => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    setNotice(null);
    const appWindow = isTauri() ? getCurrentWindow() : null;

    try {
      if (!appWindow) throw new Error("Screen capture is available in the CapSage desktop app.");
      if (captureMode === "region") {
        await invoke("start_region_selection");
        return;
      }
      const result = await invoke<CaptureResult>("capture_active_window");
      setCapture(result);
      setCaptureSession((session) => session + 1);
      setStage("edit");
      await restoreMainWindow();
    } catch (error) {
      await restoreMainWindow();
      showNotice({ tone: "error", message: String(error) });
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [restoreMainWindow, showNotice]);

  useEffect(() => {
    if (!isTauri()) return;
    const stops: Array<() => void> = [];
    Promise.all([
      listen<CaptureResult>("region-selected", (event) => {
        setCapture(event.payload);
        setCaptureSession((session) => session + 1);
        setStage("edit");
        void restoreMainWindow();
      }),
      listen("region-selection-cancelled", () => void restoreMainWindow()),
      listen<string>("region-selection-error", (event) => {
        void restoreMainWindow();
        showNotice({ tone: "error", message: event.payload || "Region selection failed." });
      })
    ]).then((unlisteners) => stops.push(...unlisteners));
    return () => stops.forEach((stop) => stop());
  }, [restoreMainWindow, showNotice]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let stopListening: (() => void) | undefined;
    listen("capture-hotkey", () => {
      if (!shortcutDialogOpenRef.current) void performCapture(modeRef.current);
    })
      .then((stop) => {
        stopListening = stop;
        return invoke<ShortcutStatus>("set_capture_shortcut", { shortcut: initialShortcut });
      })
      .then((status) => {
        if (!active) return;
        setShortcutReady(status.registered);
        setShortcut(status.shortcut);
        localStorage.setItem(SHORTCUT_KEY, status.shortcut);
        if (status.error) {
          showNotice({
            tone: "error",
            message: `Could not reserve ${formatShortcut(initialShortcut)}. ${status.error}`
          });
        }
      })
      .catch((error) => {
        if (!active) return;
        setShortcutReady(false);
        showNotice({
          tone: "error",
          message: `Could not reserve ${formatShortcut(initialShortcut)}. ${String(error)}`
        });
      });

    return () => {
      active = false;
      stopListening?.();
    };
  }, [performCapture, showNotice]);

  const openShortcutDialog = async () => {
    shortcutDialogOpenRef.current = true;
    setShortcutError(null);
    try {
      if (isTauri()) await invoke("suspend_capture_shortcut");
      setShortcutDialogOpen(true);
    } catch (error) {
      shortcutDialogOpenRef.current = false;
      showNotice({ tone: "error", message: String(error) });
    }
  };

  const closeShortcutDialog = async () => {
    if (shortcutSaving) return;
    setShortcutError(null);
    setShortcutSaving(true);
    try {
      if (isTauri()) {
        const status = await invoke<ShortcutStatus>("set_capture_shortcut", { shortcut });
        setShortcutReady(status.registered);
        if (status.error) {
          setShortcutError(status.error);
          return;
        }
      }
      shortcutDialogOpenRef.current = false;
      setShortcutDialogOpen(false);
    } catch (error) {
      setShortcutError(String(error));
    } finally {
      setShortcutSaving(false);
    }
  };

  const saveShortcut = async (requested: string) => {
    if (!isTauri()) return;
    setShortcutSaving(true);
    setShortcutError(null);
    try {
      const status = await invoke<ShortcutStatus>("set_capture_shortcut", { shortcut: requested });
      setShortcutReady(status.registered);
      setShortcut(status.shortcut);
      if (status.error) {
        setShortcutError(status.error);
        return;
      }
      localStorage.setItem(SHORTCUT_KEY, status.shortcut);
      shortcutDialogOpenRef.current = false;
      setShortcutDialogOpen(false);
      showNotice({ tone: "success", message: `Capture shortcut changed to ${formatShortcut(status.shortcut)}.` });
    } catch (error) {
      setShortcutError(String(error));
    } finally {
      setShortcutSaving(false);
    }
  };

  const saveImage = useCallback(async (dataUrl: string, format: "png" | "jpeg") => {
    const extension = format === "png" ? "png" : "jpg";
    if (!isTauri()) {
      showNotice({ tone: "error", message: "Saving is available in the CapSage desktop app." });
      return false;
    }
    const storedSequence = Number.parseInt(localStorage.getItem(SAVE_SEQUENCE_KEY) || "1", 10);
    const sequence = Number.isFinite(storedSequence) && storedSequence > 0 ? storedSequence : 1;
    const chosenPath = await save({
      title: "Save CapSage image",
      defaultPath: `CapSage ${sequence}.${extension}`,
      filters: [
        format === "png"
          ? { name: "PNG image", extensions: ["png"] }
          : { name: "JPEG image", extensions: ["jpg", "jpeg"] }
      ]
    });
    if (!chosenPath) return false;
    const path = /\.[a-z0-9]+$/i.test(chosenPath) ? chosenPath : `${chosenPath}.${extension}`;
    await invoke("save_image", { path, dataUrl });
    localStorage.setItem(SAVE_SEQUENCE_KEY, String(sequence + 1));
    showNotice({ tone: "success", message: `Saved ${path}` });
    return true;
  }, [showNotice]);

  return (
    <main className="app-shell">
      <TitleBar updateAvailable={startupUpdate !== null} onAbout={() => setAboutOpen(true)} />
      <div className="capture-bar">
        <span className="capture-label">Capture mode</span>
        <div className="mode-switch" role="group" aria-label="Capture mode">
          <button className={mode === "window" ? "active" : ""} onClick={() => setMode("window") }>
            <Desktop size={16} /> Active window
          </button>
          <button className={mode === "region" ? "active" : ""} onClick={() => setMode("region") }>
            <Crop size={16} /> Screen region
          </button>
        </div>
        {mode === "region" ? (
          <button className="capture-button" disabled={capturing} onClick={() => performCapture("region")}>
            {capturing ? <SpinnerGap className="spin" size={17} /> : <Camera size={17} weight="bold" />}
            {capturing ? "Capturing…" : "Select region"}
          </button>
        ) : (
          <span className="focus-instruction">Focus the target window, then press {formatShortcut(shortcut)}</span>
        )}
        <div className="capture-bar-spacer" />
        <div className={`shortcut-status ${shortcutReady ? "ready" : "warning"}`}>
          <Keyboard size={15} />
          <span>{formatShortcut(shortcut)}</span>
          {!shortcutReady && <span className="shortcut-unavailable">Unavailable</span>}
          <button className="shortcut-edit-button" type="button" onClick={() => void openShortcutDialog()} aria-label="Edit capture shortcut" title="Edit capture shortcut">
            <PencilSimple size={14} />
          </button>
        </div>
      </div>

      <CaptureStyleToolbar
        hasCapture={stage === "edit" && Boolean(capture)}
        captureSession={captureSession}
        onStyleChange={setCaptureStyle}
      />

      <div className="app-content">
        {stage === "empty" && (
          <section className="empty-state">
            <div className="empty-glow" />
            <div className="empty-icon"><img src="/icon.ico" alt="" /></div>
            <h1>Capture. Annotate. Enlighten.</h1>
            {mode === "region" && (
              <button className="button primary large" disabled={capturing} onClick={() => performCapture("region")}>
                <Camera size={19} weight="bold" /> Select screen region
              </button>
            )}
            <div className="shortcut-hint">
              {shortcutTokens(shortcut).map((token, index) => (
                <span className="shortcut-key-part" key={`${token}-${index}`}>
                  {index > 0 && <span>+</span>}
                  <kbd>{token}</kbd>
                </span>
              ))}
              <small>works from any app</small>
            </div>
          </section>
        )}
        {stage === "edit" && capture && (
          <Editor
            capture={capture}
            captureStyle={captureStyle}
            onCrop={setCapture}
            onSave={saveImage}
            onClear={() => {
              setCapture(null);
              setStage("empty");
            }}
          />
        )}
      </div>

      {notice && (
        <div className={`notice ${notice.tone}`}>
          {notice.tone === "success" ? <CheckCircle size={19} weight="fill" /> : <WarningCircle size={19} weight="fill" />}
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {shortcutDialogOpen && (
        <ShortcutDialog
          currentShortcut={shortcut}
          busy={shortcutSaving}
          error={shortcutError}
          onCancel={() => void closeShortcutDialog()}
          onSave={saveShortcut}
        />
      )}
      {aboutOpen && (
        <AboutDialog
          version={appVersion}
          initialUpdateInfo={startupUpdate}
          onClose={() => setAboutOpen(false)}
        />
      )}
    </main>
  );
}
