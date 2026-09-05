import { memo, useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Camera,
  CheckCircle,
  Crop,
  Desktop,
  FolderOpen,
  Keyboard,
  PencilSimple,
  SpinnerGap,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import { Editor } from "./components/Editor";
import { AboutDialog } from "./components/AboutDialog";
import { CaptureStyleToolbar } from "./components/CaptureStyleToolbar";
import { OpenDialog } from "./components/OpenDialog";
import { formatShortcut, ShortcutDialog, shortcutTokens } from "./components/ShortcutDialog";
import { TitleBar } from "./components/TitleBar";
import {
  createManifest,
  emptyDocumentState,
  parseManifest,
  type EditorDocumentState
} from "./editor/document";
import {
  CAPTURE_STYLES_KEY,
  DEFAULT_CAPTURE_STYLE,
  loadActiveCaptureStyle,
  loadCaptureStyles,
  type CaptureStyle
} from "./editor/style";
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

const stateForReplacement = (
  state: EditorDocumentState,
  previous: CaptureResult,
  next: CaptureResult
): EditorDocumentState => {
  const scaleX = next.width / previous.width;
  const scaleY = next.height / previous.height;
  return {
    crop: null,
    callouts: state.callouts.map((callout) => {
      const width = Math.min(next.width, callout.width * scaleX);
      const height = Math.min(next.height, callout.height * scaleY);
      return {
        ...callout,
        x: Math.max(0, Math.min(next.width - width, callout.x * scaleX)),
        y: Math.max(0, Math.min(next.height - height, callout.y * scaleY)),
        width,
        height,
        targetX: Math.max(0, Math.min(next.width, callout.targetX * scaleX)),
        targetY: Math.max(0, Math.min(next.height, callout.targetY * scaleY)),
        ...(callout.minimumWidth === undefined ? {} : { minimumWidth: callout.minimumWidth * scaleX }),
        ...(callout.manualWidth === undefined ? {} : { manualWidth: callout.manualWidth * scaleX })
      };
    }),
    focuses: state.focuses.map((focus) => {
      const width = Math.min(next.width, focus.width * scaleX);
      const height = Math.min(next.height, focus.height * scaleY);
      return {
        ...focus,
        x: Math.max(0, Math.min(next.width - width, focus.x * scaleX)),
        y: Math.max(0, Math.min(next.height - height, focus.y * scaleY)),
        width,
        height
      };
    })
  };
};

type CaptureDocumentPanelProps = {
  document: CaptureDocument;
  active: boolean;
  styles: CaptureStyle[];
  onCreateStyle: (style: CaptureStyle) => void;
  onDeleteStyle: (id: string) => void;
  onSaveStyle: (style: CaptureStyle) => void;
  onUpdate: (id: string, patch: Partial<CaptureDocument>) => void;
  onSave: (id: string, state: EditorDocumentState, saveAs: boolean) => Promise<void>;
  onExport: (id: string, dataUrl: string, format: "png" | "jpeg") => Promise<boolean>;
  onReplace: (id: string) => void;
  replacementArmed: boolean;
};

const CaptureDocumentPanel = memo(function CaptureDocumentPanel({
  document,
  active,
  styles,
  onCreateStyle,
  onDeleteStyle,
  onSaveStyle,
  onUpdate,
  onSave,
  onExport,
  onReplace,
  replacementArmed
}: CaptureDocumentPanelProps) {
  const documentId = document.id;
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
        initialStyle={document.style}
        styles={styles}
        onCreateStyle={onCreateStyle}
        onDeleteStyle={onDeleteStyle}
        onSaveStyle={onSaveStyle}
        onStyleChange={updateStyle}
      />
      <Editor
        capture={document.capture}
        captureStyle={document.style}
        initialDocumentState={document.state}
        onDocumentChange={updateState}
        onSaveDocument={saveDocument}
        documentSaving={document.saving}
        canSaveAs={document.path !== null}
        onExport={exportImage}
        onReplace={() => onReplace(documentId)}
        replacementArmed={replacementArmed}
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
  const [captureStyles, setCaptureStyles] = useState<CaptureStyle[]>(loadCaptureStyles);
  const captureStylesRef = useRef(captureStyles);
  captureStylesRef.current = captureStyles;
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [replacementDocumentId, setReplacementDocumentIdState] = useState<string | null>(null);
  const replacementDocumentIdRef = useRef<string | null>(null);
  const [shortcutReady, setShortcutReady] = useState(false);
  const [shortcut, setShortcut] = useState(initialShortcut);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [pendingCloseDocumentId, setPendingCloseDocumentId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [startupUpdate, setStartupUpdate] = useState<UpdateInfo | null>(null);
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

  const setReplacementDocumentId = useCallback((id: string | null) => {
    replacementDocumentIdRef.current = id;
    setReplacementDocumentIdState(id);
  }, []);

  const restoreMainWindow = useCallback(async () => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    try { await appWindow.show(); } catch { /* Best-effort recovery. */ }
    try { await appWindow.unminimize(); } catch { /* The window may not be minimized. */ }
    try { await appWindow.setFocus(); } catch { /* Windows can deny foreground focus. */ }
  }, []);

  const addDocument = useCallback((initial: Omit<CaptureDocument, "id" | "saving">) => {
    const document: CaptureDocument = {
      ...initial,
      id: crypto.randomUUID(),
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

  const storeCaptureStyles = useCallback((next: CaptureStyle[]) => {
    captureStylesRef.current = next;
    setCaptureStyles(next);
    localStorage.setItem(CAPTURE_STYLES_KEY, JSON.stringify(next));
  }, []);

  const createCaptureStyle = useCallback((style: CaptureStyle) => {
    storeCaptureStyles([...captureStylesRef.current, style]);
  }, [storeCaptureStyles]);

  const saveCaptureStyle = useCallback((style: CaptureStyle) => {
    storeCaptureStyles(captureStylesRef.current.map((candidate) =>
      candidate.id === style.id ? style : candidate
    ));
    setDocuments((current) => {
      const next = current.map((document) =>
        document.style.id === style.id ? { ...document, style } : document
      );
      documentsRef.current = next;
      return next;
    });
  }, [storeCaptureStyles]);

  const deleteCaptureStyle = useCallback((id: string) => {
    const fallback = captureStylesRef.current.find((style) =>
      style.id === DEFAULT_CAPTURE_STYLE.id
    ) ?? DEFAULT_CAPTURE_STYLE;
    storeCaptureStyles(captureStylesRef.current.filter((style) => style.id !== id));
    setDocuments((current) => {
      const next = current.map((document) =>
        document.style.id === id ? { ...document, style: fallback } : document
      );
      documentsRef.current = next;
      return next;
    });
  }, [storeCaptureStyles]);

  const removeDocument = useCallback((id: string) => {
    const current = documentsRef.current;
    const index = current.findIndex((document) => document.id === id);
    if (index < 0) return;
    const nextActiveId = current[index + 1]?.id ?? current[index - 1]?.id ?? null;
    const next = current.filter((document) => document.id !== id);
    documentsRef.current = next;
    setDocuments(next);
    if (replacementDocumentIdRef.current === id) setReplacementDocumentId(null);
    setActiveDocumentId((activeId) => activeId === id ? nextActiveId : activeId);
  }, [setReplacementDocumentId]);

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

  const finishCapture = useCallback((result: CaptureResult) => {
    const replacementId = replacementDocumentIdRef.current;
    if (!replacementId) {
      beginUnsavedDocument(result);
      return;
    }
    const document = documentsRef.current.find((candidate) => candidate.id === replacementId);
    setReplacementDocumentId(null);
    if (!document) {
      beginUnsavedDocument(result);
      return;
    }
    const state = stateForReplacement(document.state, document.capture, result);
    updateDocument(replacementId, { capture: result, state });
    setActiveDocumentId(replacementId);
    showNotice({ tone: "success", message: "Capture replaced. Annotations were preserved and the crop was cleared." });
  }, [beginUnsavedDocument, setReplacementDocumentId, showNotice, updateDocument]);

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
      finishCapture(result);
      await restoreMainWindow();
    } catch (error) {
      setReplacementDocumentId(null);
      await restoreMainWindow();
      showNotice({ tone: "error", message: String(error) });
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [finishCapture, restoreMainWindow, setReplacementDocumentId, showNotice]);

  const requestReplacement = useCallback((documentId: string) => {
    if (replacementDocumentIdRef.current === documentId) {
      setReplacementDocumentId(null);
      showNotice(null);
      return;
    }
    setReplacementDocumentId(documentId);
    setActiveDocumentId(documentId);
    if (modeRef.current === "region") {
      void performCapture("region");
      return;
    }
    showNotice({
      tone: "success",
      message: `Replacement armed. Focus the target window, then press ${formatShortcut(shortcut)}.`
    });
  }, [performCapture, setReplacementDocumentId, shortcut, showNotice]);

  useEffect(() => {
    if (!isTauri()) return;
    const stops: Array<() => void> = [];
    Promise.all([
      listen<CaptureResult>("region-selected", (event) => {
        localStorage.setItem(REGION_WIDTH_KEY, String(event.payload.width));
        localStorage.setItem(REGION_HEIGHT_KEY, String(event.payload.height));
        localStorage.setItem(REGION_X_KEY, String(event.payload.originX));
        localStorage.setItem(REGION_Y_KEY, String(event.payload.originY));
        finishCapture(event.payload);
        void restoreMainWindow();
      }),
      listen("region-selection-cancelled", () => {
        setReplacementDocumentId(null);
        void restoreMainWindow();
      }),
      listen<string>("region-selection-error", (event) => {
        setReplacementDocumentId(null);
        void restoreMainWindow();
        showNotice({ tone: "error", message: event.payload || "Region selection failed." });
      })
    ]).then((unlisteners) => stops.push(...unlisteners));
    return () => stops.forEach((stop) => stop());
  }, [finishCapture, restoreMainWindow, setReplacementDocumentId, showNotice]);

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

  const openCapturePath = useCallback(async (path: string) => {
    try {
      const opened = await invoke<OpenedCaptureFile>("open_capture_file", { path });
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
          path,
          name: fileName(path),
          createdAt: restored.createdAt,
          baseline: documentBaseline(nextCapture, restored.state, restored.captureStyle),
          style: restored.captureStyle
        });
        showNotice({ tone: "success", message: `Opened ${fileName(path)}` });
      } else {
        beginUnsavedDocument(nextCapture, capsageNameFor(path));
        showNotice({ tone: "success", message: `Imported ${fileName(path)}` });
      }
    } catch (error) {
      showNotice({ tone: "error", message: String(error) });
    } finally {
      await restoreMainWindow();
    }
  }, [addDocument, beginUnsavedDocument, restoreMainWindow, showNotice]);

  const openFile = useCallback(() => {
    if (!isTauri()) {
      showNotice({ tone: "error", message: "Opening files is available in the CapSage desktop app." });
      return;
    }
    setOpenDialogOpen(true);
  }, [showNotice]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let stopListening: (() => void) | undefined;
    void (async () => {
      const stop = await listen<string>("open-document-requested", (event) => {
        void openCapturePath(event.payload);
      });
      if (!active) {
        stop();
        return;
      }
      stopListening = stop;
      const pending = await invoke<string | null>("take_pending_open_document");
      if (active && pending) await openCapturePath(pending);
    })();
    return () => {
      active = false;
      stopListening?.();
    };
  }, [openCapturePath]);

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
        onAbout={() => setAboutOpen(true)}
      />
      <div className="capture-bar">
        <button
          className="button secondary capture-open-button"
          type="button"
          onClick={openFile}
          title="Open a CapSage document"
        >
          <FolderOpen size={16} weight="bold" /> Open
        </button>
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
            styles={captureStyles}
            onCreateStyle={createCaptureStyle}
            onDeleteStyle={deleteCaptureStyle}
            onSaveStyle={saveCaptureStyle}
            onUpdate={updateDocument}
            onSave={saveDocument}
            onExport={exportImage}
            onReplace={requestReplacement}
            replacementArmed={replacementDocumentId === document.id}
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
      {openDialogOpen && (
        <OpenDialog
          onCancel={() => setOpenDialogOpen(false)}
          onOpen={(path) => {
            setOpenDialogOpen(false);
            void openCapturePath(path);
          }}
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
