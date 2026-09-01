import { memo, useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Camera,
  CheckCircle,
  Crop,
  Desktop,
  Keyboard,
  PencilSimple,
  SpinnerGap,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import { Editor } from "./components/Editor";
import { AboutDialog } from "./components/AboutDialog";
import { CaptureStyleToolbar } from "./components/CaptureStyleToolbar";
import { formatShortcut, ShortcutDialog, shortcutTokens } from "./components/ShortcutDialog";
import { TitleBar } from "./components/TitleBar";
import {
  createManifest,
  emptyDocumentState,
  parseManifest,
  type EditorDocumentState
} from "./editor/document";
import { loadActiveCaptureStyle, type CaptureStyle } from "./editor/style";
import type { CaptureMode, CaptureResult } from "./editor/types";
import { checkForUpdate, getAppVersion, type UpdateInfo } from "./lib/updater";

const DEFAULT_SHORTCUT = "Ctrl+Alt+PrintScreen";
const MODE_KEY = "capsage.capture-mode";
const SHORTCUT_KEY = "capsage.capture-shortcut";
const SAVE_SEQUENCE_KEY = "capsage.save-sequence";
const REGION_WIDTH_KEY = "capsage.region-width";
const REGION_HEIGHT_KEY = "capsage.region-height";
const REGION_X_KEY = "capsage.region-x";
const REGION_Y_KEY = "capsage.region-y";

type Notice = { tone: "success" | "error"; message: string } | null;
type ShortcutStatus = { registered: boolean; shortcut: string; error: string | null };
type DocumentBaseline = { dataUrl: string; metadata: string };
type OpenedCaptureFile = CaptureResult & {
  kind: "document" | "image";
  manifestJson: string | null;
};

type CaptureDocument = {
  id: string;
  captureSession: number;
  capture: CaptureResult;
  state: EditorDocumentState;
  path: string | null;
  name: string;
  createdAt: string;
  baseline: DocumentBaseline | null;
  saving: boolean;
  style: CaptureStyle;
};

const documentMetadata = (
  capture: CaptureResult,
  state: EditorDocumentState,
  style: CaptureStyle
) => JSON.stringify({
  width: capture.width,
  height: capture.height,
  originX: capture.originX,
  originY: capture.originY,
  state,
  style
});

const documentBaseline = (
  capture: CaptureResult,
  state: EditorDocumentState,
  style: CaptureStyle
): DocumentBaseline => ({ dataUrl: capture.dataUrl, metadata: documentMetadata(capture, state, style) });

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
const capsageNameFor = (path: string) => `${fileName(path).replace(/\.[^.]+$/, "") || "Untitled"}.capsage`;

const isDocumentDirty = (document: CaptureDocument) => {
  const metadata = documentMetadata(document.capture, document.state, document.style);
  return !document.baseline
    || document.baseline.dataUrl !== document.capture.dataUrl
    || document.baseline.metadata !== metadata;
};

type CaptureDocumentPanelProps = {
  document: CaptureDocument;
  active: boolean;
  onUpdate: (id: string, patch: Partial<CaptureDocument>) => void;
  onSave: (id: string, state: EditorDocumentState, saveAs: boolean) => Promise<void>;
  onExport: (id: string, dataUrl: string, format: "png" | "jpeg") => Promise<boolean>;
};

const CaptureDocumentPanel = memo(function CaptureDocumentPanel({
  document,
  active,
  onUpdate,
  onSave,
  onExport
}: CaptureDocumentPanelProps) {
  const documentId = document.id;
  const updateCapture = useCallback((capture: CaptureResult) => {
    onUpdate(documentId, { capture });
  }, [documentId, onUpdate]);
  const updateState = useCallback((state: EditorDocumentState) => {
    onUpdate(documentId, { state });
  }, [documentId, onUpdate]);
  const updateStyle = useCallback((style: CaptureStyle) => {
    onUpdate(documentId, { style });
  }, [documentId, onUpdate]);
  const saveDocument = useCallback((state: EditorDocumentState, saveAs: boolean) =>
    onSave(documentId, state, saveAs), [documentId, onSave]);
  const exportImage = useCallback((dataUrl: string, format: "png" | "jpeg") =>
    onExport(documentId, dataUrl, format), [documentId, onExport]);

  return (
    <section
      id={`capture-panel-${documentId}`}
      className={`capture-document ${active ? "active" : ""}`}
      role="tabpanel"
      aria-labelledby={`capture-tab-${documentId}`}
      aria-hidden={!active}
    >
      <CaptureStyleToolbar
        hasCapture
        captureSession={document.captureSession}
        initialStyle={document.style}
        onStyleChange={updateStyle}
      />
      <Editor
        capture={document.capture}
        captureStyle={document.style}
        initialDocumentState={document.state}
        onCrop={updateCapture}
        onDocumentChange={updateState}
        onSaveDocument={saveDocument}
        documentSaving={document.saving}
        onExport={exportImage}
      />
    </section>
  );
});

export default function App() {
  const initialMode = localStorage.getItem(MODE_KEY) === "region" ? "region" : "window";
  const initialShortcut = localStorage.getItem(SHORTCUT_KEY) || DEFAULT_SHORTCUT;
  const [mode, setModeState] = useState<CaptureMode>(initialMode);
  const modeRef = useRef(mode);
  const capturingRef = useRef(false);
  const shortcutDialogOpenRef = useRef(false);
  const [documents, setDocuments] = useState<CaptureDocument[]>([]);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const captureSessionRef = useRef(0);
  const [capturing, setCapturing] = useState(false);
  const [shortcutReady, setShortcutReady] = useState(false);
  const [shortcut, setShortcut] = useState(initialShortcut);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingCloseDocumentId, setPendingCloseDocumentId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [startupUpdate, setStartupUpdate] = useState<UpdateInfo | null>(null);
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null;
  const activeDocumentDirty = activeDocument ? isDocumentDirty(activeDocument) : false;
  const pendingCloseDocument = documents.find(
    (document) => document.id === pendingCloseDocumentId
  ) ?? null;

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

  const addDocument = useCallback((initial: Omit<CaptureDocument, "id" | "captureSession" | "saving">) => {
    const document: CaptureDocument = {
      ...initial,
      id: crypto.randomUUID(),
      captureSession: ++captureSessionRef.current,
      saving: false
    };
    setDocuments((current) => {
      const next = [...current, document];
      documentsRef.current = next;
      return next;
    });
    setActiveDocumentId(document.id);
  }, []);

  const updateDocument = useCallback((id: string, patch: Partial<CaptureDocument>) => {
    setDocuments((current) => {
      const next = current.map((document) => document.id === id ? { ...document, ...patch } : document);
      documentsRef.current = next;
      return next;
    });
  }, []);

  const removeDocument = useCallback((id: string) => {
    const current = documentsRef.current;
    const index = current.findIndex((document) => document.id === id);
    if (index < 0) return;
    const nextActiveId = current[index + 1]?.id ?? current[index - 1]?.id ?? null;
    const next = current.filter((document) => document.id !== id);
    documentsRef.current = next;
    setDocuments(next);
    setActiveDocumentId((activeId) => activeId === id ? nextActiveId : activeId);
  }, []);

  const beginUnsavedDocument = useCallback((result: CaptureResult, suggestedName = "Untitled.capsage") => {
    const state = emptyDocumentState();
    const style = loadActiveCaptureStyle();
    addDocument({
      capture: result,
      state,
      path: null,
      name: suggestedName,
      createdAt: new Date().toISOString(),
      baseline: documentBaseline(result, state, style),
      style
    });
  }, [addDocument]);

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
        const storedWidth = Number.parseInt(localStorage.getItem(REGION_WIDTH_KEY) ?? "", 10);
        const storedHeight = Number.parseInt(localStorage.getItem(REGION_HEIGHT_KEY) ?? "", 10);
        const storedX = Number.parseInt(localStorage.getItem(REGION_X_KEY) ?? "", 10);
        const storedY = Number.parseInt(localStorage.getItem(REGION_Y_KEY) ?? "", 10);
        const hasStoredSize = Number.isFinite(storedWidth) && storedWidth > 0
          && Number.isFinite(storedHeight) && storedHeight > 0;
        const hasStoredPosition = Number.isFinite(storedX) && Number.isFinite(storedY);
        await invoke("start_region_selection", {
          width: hasStoredSize ? storedWidth : null,
          height: hasStoredSize ? storedHeight : null,
          x: hasStoredPosition ? storedX : null,
          y: hasStoredPosition ? storedY : null
        });
        return;
      }
      const result = await invoke<CaptureResult>("capture_active_window");
      beginUnsavedDocument(result);
      await restoreMainWindow();
    } catch (error) {
      await restoreMainWindow();
      showNotice({ tone: "error", message: String(error) });
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [beginUnsavedDocument, restoreMainWindow, showNotice]);

  useEffect(() => {
    if (!isTauri()) return;
    const stops: Array<() => void> = [];
    Promise.all([
      listen<CaptureResult>("region-selected", (event) => {
        localStorage.setItem(REGION_WIDTH_KEY, String(event.payload.width));
        localStorage.setItem(REGION_HEIGHT_KEY, String(event.payload.height));
        localStorage.setItem(REGION_X_KEY, String(event.payload.originX));
        localStorage.setItem(REGION_Y_KEY, String(event.payload.originY));
        beginUnsavedDocument(event.payload);
        void restoreMainWindow();
      }),
      listen("region-selection-cancelled", () => void restoreMainWindow()),
      listen<string>("region-selection-error", (event) => {
        void restoreMainWindow();
        showNotice({ tone: "error", message: event.payload || "Region selection failed." });
      })
    ]).then((unlisteners) => stops.push(...unlisteners));
    return () => stops.forEach((stop) => stop());
  }, [beginUnsavedDocument, restoreMainWindow, showNotice]);

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

  const openFile = useCallback(async () => {
    if (!isTauri()) {
      showNotice({ tone: "error", message: "Opening files is available in the CapSage desktop app." });
      return;
    }
    try {
      const chosen = await open({
        title: "Open a CapSage document or image",
        multiple: false,
        directory: false,
        filters: [
          { name: "CapSage documents and images", extensions: ["capsage", "png", "jpg", "jpeg"] },
          { name: "CapSage document", extensions: ["capsage"] },
          { name: "PNG or JPEG image", extensions: ["png", "jpg", "jpeg"] }
        ]
      });
      if (!chosen || Array.isArray(chosen)) return;
      const opened = await invoke<OpenedCaptureFile>("open_capture_file", { path: chosen });
      const nextCapture: CaptureResult = {
        dataUrl: opened.dataUrl,
        width: opened.width,
        height: opened.height,
        originX: opened.originX,
        originY: opened.originY
      };
      if (opened.kind === "document") {
        if (!opened.manifestJson) throw new Error("The CapSage document has no manifest.");
        const restored = parseManifest(opened.manifestJson);
        addDocument({
          capture: nextCapture,
          state: restored.state,
          path: chosen,
          name: fileName(chosen),
          createdAt: restored.createdAt,
          baseline: documentBaseline(nextCapture, restored.state, restored.captureStyle),
          style: restored.captureStyle
        });
        showNotice({ tone: "success", message: `Opened ${fileName(chosen)}` });
      } else {
        beginUnsavedDocument(nextCapture, capsageNameFor(chosen));
        showNotice({ tone: "success", message: `Imported ${fileName(chosen)}` });
      }
    } catch (error) {
      showNotice({ tone: "error", message: String(error) });
    }
  }, [addDocument, beginUnsavedDocument, showNotice]);

  const saveDocument = useCallback(async (
    documentId: string,
    state: EditorDocumentState,
    saveAs: boolean
  ) => {
    const document = documentsRef.current.find((candidate) => candidate.id === documentId);
    if (!document || !isTauri()) {
      showNotice({ tone: "error", message: "Saving documents is available in the CapSage desktop app." });
      return;
    }
    updateDocument(documentId, { saving: true });
    try {
      let path = saveAs ? null : document.path;
      if (!path) {
        const chosenPath = await save({
          title: saveAs ? "Save CapSage document as" : "Save CapSage document",
          defaultPath: document.path ?? document.name,
          filters: [{ name: "CapSage document", extensions: ["capsage"] }]
        });
        if (!chosenPath) return;
        path = chosenPath.toLowerCase().endsWith(".capsage") ? chosenPath : `${chosenPath}.capsage`;
      }
      const manifest = createManifest(document.capture, state, document.style, document.createdAt);
      await invoke("save_capsage_document", {
        path,
        manifestJson: JSON.stringify(manifest),
        dataUrl: document.capture.dataUrl
      });
      updateDocument(documentId, {
        path,
        name: fileName(path),
        baseline: documentBaseline(document.capture, state, document.style)
      });
      showNotice({ tone: "success", message: `Saved ${path}` });
    } catch (error) {
      showNotice({ tone: "error", message: String(error) });
    } finally {
      updateDocument(documentId, { saving: false });
    }
  }, [showNotice, updateDocument]);

  const exportImage = useCallback(async (
    documentId: string,
    dataUrl: string,
    format: "png" | "jpeg"
  ) => {
    const extension = format === "png" ? "png" : "jpg";
    if (!isTauri()) {
      showNotice({ tone: "error", message: "Saving is available in the CapSage desktop app." });
      return false;
    }
    const document = documentsRef.current.find((candidate) => candidate.id === documentId);
    if (!document) return false;
    const storedSequence = Number.parseInt(localStorage.getItem(SAVE_SEQUENCE_KEY) || "1", 10);
    const sequence = Number.isFinite(storedSequence) && storedSequence > 0 ? storedSequence : 1;
    const defaultPath = document.path
      ? document.path.replace(/\.capsage$/i, `.${extension}`)
      : `CapSage ${sequence}.${extension}`;
    const chosenPath = await save({
      title: "Export CapSage image",
      defaultPath,
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
    showNotice({ tone: "success", message: `Exported ${path}` });
    return true;
  }, [showNotice]);

  const requestCloseDocument = useCallback((documentId: string) => {
    const document = documentsRef.current.find((candidate) => candidate.id === documentId);
    if (!document) return;
    if (document.saving) {
      showNotice({ tone: "error", message: `Wait for ${document.name} to finish saving before closing it.` });
      return;
    }
    if (isDocumentDirty(document)) {
      setPendingCloseDocumentId(documentId);
      return;
    }
    removeDocument(documentId);
  }, [removeDocument, showNotice]);

  const confirmCloseDocument = useCallback(() => {
    const documentId = pendingCloseDocumentId;
    if (!documentId) return;
    const document = documentsRef.current.find((candidate) => candidate.id === documentId);
    setPendingCloseDocumentId(null);
    if (!document) return;
    if (document.saving) {
      showNotice({ tone: "error", message: `Wait for ${document.name} to finish saving before closing it.` });
      return;
    }
    removeDocument(documentId);
  }, [pendingCloseDocumentId, removeDocument, showNotice]);

  return (
    <main className="app-shell">
      <TitleBar
        updateAvailable={startupUpdate !== null}
        documentLabel={activeDocument?.name ?? null}
        documentDirty={activeDocumentDirty}
        onOpen={() => void openFile()}
        onAbout={() => setAboutOpen(true)}
      />
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

      {documents.length > 0 && (
        <div className="capture-tabs" role="tablist" aria-label="Open captures">
          {documents.map((document) => {
            const active = document.id === activeDocumentId;
            const dirty = isDocumentDirty(document);
            const label = document.path ? document.name : "New Capture";
            return (
              <div className={`capture-tab ${active ? "active" : ""}`} key={document.id}>
                <button
                  id={`capture-tab-${document.id}`}
                  type="button"
                  className="capture-tab-select"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`capture-panel-${document.id}`}
                  aria-label={dirty ? `${label}, unsaved changes` : label}
                  title={document.path ?? document.name}
                  onClick={() => setActiveDocumentId(document.id)}
                >
                  <span>
                    {label}
                    {dirty && <i className="capture-tab-dirty" aria-hidden="true">*</i>}
                  </span>
                </button>
                <button
                  type="button"
                  className="capture-tab-close"
                  aria-label={`Close ${label}`}
                  title={document.saving ? "Saving…" : `Close ${label}`}
                  disabled={document.saving}
                  onClick={() => requestCloseDocument(document.id)}
                >
                  {document.saving
                    ? <SpinnerGap className="spin" size={13} />
                    : <X size={13} weight="bold" />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="app-content">
        {documents.length === 0 && (
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
        {documents.map((document) => (
          <CaptureDocumentPanel
            key={document.id}
            document={document}
            active={document.id === activeDocumentId}
            onUpdate={updateDocument}
            onSave={saveDocument}
            onExport={exportImage}
          />
        ))}
      </div>

      {notice && (
        <div className={`notice ${notice.tone}`}>
          {notice.tone === "success" ? <CheckCircle size={19} weight="fill" /> : <WarningCircle size={19} weight="fill" />}
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {pendingCloseDocument && (
        <div
          className="confirm-overlay"
          role="presentation"
          onPointerDown={() => setPendingCloseDocumentId(null)}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-capture-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="confirm-icon"><WarningCircle size={22} weight="fill" /></div>
            <div className="confirm-copy">
              <h2 id="close-capture-title">Close {pendingCloseDocument.path ? pendingCloseDocument.name : "this capture"}?</h2>
              <p>This capture has unsaved changes. Closing it will discard them.</p>
            </div>
            <div className="confirm-actions">
              <button
                autoFocus
                className="button secondary"
                onClick={() => setPendingCloseDocumentId(null)}
              >
                Cancel
              </button>
              <button className="button danger" onClick={confirmCloseDocument}>
                Close without saving
              </button>
            </div>
          </div>
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
