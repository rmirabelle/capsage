import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ChatCenteredText,
  Check,
  Crop,
  DownloadSimple,
  FloppyDisk,
  FrameCorners,
  Minus,
  Plus,
  Trash,
  XCircle
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { distance, pointInCallout, pointInFocus } from "../editor/geometry";
import { drawScene, measureCalloutForText, measureCalloutHeightForWidth } from "../editor/draw";
import type { EditorDocumentState } from "../editor/document";
import {
  MIN_FOCUS_SIZE,
  calloutFontSize,
  calloutPaddingX,
  calloutPaddingY,
  captureStyleLineHeight,
  minCalloutHeight,
  minCalloutWidth,
  type CaptureStyle
} from "../editor/style";
import type { Callout, CaptureResult, CropRegion, FocusRegion, Point } from "../editor/types";
import { SaveDialog, type SaveFormat, type SaveSettings } from "./SaveDialog";

type CalloutResizeHandle = "w" | "e";
type FocusResizeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
type EditorSnapshot = { callouts: Callout[]; focuses: FocusRegion[]; crop: CropRegion | null };
type PanState = { pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number };
type CropDragState =
  | { kind: "move"; start: Point; original: CropRegion }
  | { kind: "resize"; handle: FocusResizeHandle; original: CropRegion };
type DragState =
  | { kind: "move-callout"; id: string; start: Point; original: Callout; before: EditorSnapshot }
  | { kind: "resize-callout"; id: string; handle: CalloutResizeHandle; original: Callout; before: EditorSnapshot }
  | { kind: "target"; id: string; before: EditorSnapshot }
  | { kind: "move-focus"; id: string; start: Point; original: FocusRegion; before: EditorSnapshot }
  | { kind: "resize-focus"; id: string; handle: FocusResizeHandle; original: FocusRegion; before: EditorSnapshot };

interface Props {
  capture: CaptureResult;
  captureStyle: CaptureStyle;
  initialDocumentState: EditorDocumentState;
  onDocumentChange: (state: EditorDocumentState) => void;
  onSaveDocument: (state: EditorDocumentState, saveAs: boolean) => Promise<void>;
  documentSaving: boolean;
  canSaveAs: boolean;
  onExport: (dataUrl: string, format: "png" | "jpeg") => Promise<boolean>;
  onReplace: () => void;
  replacementArmed: boolean;
}

const cloneCallouts = (callouts: Callout[]) => callouts.map((callout) => ({ ...callout }));
const cloneFocuses = (focuses: FocusRegion[]) => focuses.map((focus) => ({ ...focus }));
const cloneCrop = (crop: CropRegion | null) => crop ? { ...crop } : null;
const ZOOM_LEVELS = [0.05, 0.067, 0.1, 0.125, 0.16, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
const SAVE_FORMAT_KEY = "capsage.save-format";
const SAVE_MAX_WIDTH_KEY = "capsage.save-max-width";
const SAVE_MAX_HEIGHT_KEY = "capsage.save-max-height";
const cloneSnapshot = (snapshot: EditorSnapshot): EditorSnapshot => ({
  callouts: cloneCallouts(snapshot.callouts),
  focuses: cloneFocuses(snapshot.focuses),
  crop: cloneCrop(snapshot.crop)
});

export function Editor({
  capture,
  captureStyle,
  initialDocumentState,
  onDocumentChange,
  onSaveDocument,
  documentSaving,
  canSaveAs,
  onExport,
  onReplace,
  replacementArmed
}: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const calloutsRef = useRef<Callout[]>([]);
  const focusesRef = useRef<FocusRegion[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const cropDragRef = useRef<CropDragState | null>(null);
  const initialDocumentStateRef = useRef(initialDocumentState);
  initialDocumentStateRef.current = initialDocumentState;
  const cropRef = useRef<CropRegion | null>(cloneCrop(initialDocumentState.crop));
  const panRef = useRef<PanState | null>(null);
  const textBeforeRef = useRef<EditorSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 900, height: 600 });
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);
  const [zoom, setZoom] = useState<number | null>(null);
  const [panning, setPanning] = useState(false);
  const [callouts, setCalloutsState] = useState<Callout[]>([]);
  const [focuses, setFocusesState] = useState<FocusRegion[]>([]);
  const [crop, setCropState] = useState<CropRegion | null>(cloneCrop(initialDocumentState.crop));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [format, setFormat] = useState<SaveFormat>(() => localStorage.getItem(SAVE_FORMAT_KEY) === "jpeg" ? "jpeg" : "png");
  const [maxWidthInput, setMaxWidthInput] = useState(() => localStorage.getItem(SAVE_MAX_WIDTH_KEY) ?? "");
  const [maxHeightInput, setMaxHeightInput] = useState(() => localStorage.getItem(SAVE_MAX_HEIGHT_KEY) ?? "");
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [cropRect, setCropRect] = useState<CropRegion | null>(null);

  const fullViewport: CropRegion = { x: 0, y: 0, width: capture.width, height: capture.height };
  const viewport = cropRect ? fullViewport : crop ?? fullViewport;
  const viewportRight = viewport.x + viewport.width;
  const viewportBottom = viewport.y + viewport.height;

  const fitScale = Math.min(
    Math.max(0.05, ((workspaceSize.width - 48) * pixelRatio) / viewport.width),
    Math.max(0.05, ((workspaceSize.height - 48) * pixelRatio) / viewport.height),
    1
  );
  const displayScale = zoom ?? fitScale;
  const cssScale = displayScale / pixelRatio;
  const selectedCallout = callouts.find((callout) => callout.id === selectedId) ?? null;
  const selectedFocus = focuses.find((focus) => focus.id === selectedId) ?? null;
  const effectiveStyle = captureStyle;
  const effectiveCalloutPaddingX = calloutPaddingX(effectiveStyle);
  const effectiveCalloutPaddingY = calloutPaddingY(effectiveStyle);

  const setCallouts = useCallback((next: Callout[]) => {
    calloutsRef.current = next;
    setCalloutsState(next);
  }, []);

  const setFocuses = useCallback((next: FocusRegion[]) => {
    focusesRef.current = next;
    setFocusesState(next);
  }, []);

  const setCrop = useCallback((next: CropRegion | null) => {
    cropRef.current = cloneCrop(next);
    setCropState(cloneCrop(next));
  }, []);

  const currentSnapshot = (): EditorSnapshot => ({
    callouts: cloneCallouts(calloutsRef.current),
    focuses: cloneFocuses(focusesRef.current),
    crop: cloneCrop(cropRef.current)
  });

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    setCallouts(cloneCallouts(snapshot.callouts));
    setFocuses(cloneFocuses(snapshot.focuses));
    setCrop(cloneCrop(snapshot.crop));
  }, [setCallouts, setCrop, setFocuses]);

  const record = useCallback((before: EditorSnapshot) => {
    const current = { callouts: calloutsRef.current, focuses: focusesRef.current, crop: cropRef.current };
    if (JSON.stringify(before) === JSON.stringify(current)) return;
    setPast((items) => [...items, cloneSnapshot(before)].slice(-60));
    setFuture([]);
  }, []);

  useEffect(() => {
    setReady(false);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const initialState = initialDocumentStateRef.current;
      setCallouts(cloneCallouts(initialState.callouts));
      setFocuses(cloneFocuses(initialState.focuses));
      setCrop(cloneCrop(initialState.crop));
      setReady(true);
    };
    image.src = capture.dataUrl;
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setEditingId(null);
    setCropRect(null);
    setZoom(null);
  }, [capture.dataUrl, setCallouts, setCrop, setFocuses]);

  useEffect(() => {
    if (!ready) return;
    onDocumentChange({
      callouts: cloneCallouts(callouts),
      focuses: cloneFocuses(focuses),
      crop: cloneCrop(crop)
    });
  }, [callouts, crop, focuses, onDocumentChange, ready]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWorkspaceSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      setPixelRatio(window.devicePixelRatio || 1);
    });
    const onWindowResize = () => setPixelRatio(window.devicePixelRatio || 1);
    observer.observe(element);
    window.addEventListener("resize", onWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    drawScene(canvas.getContext("2d")!, image, callouts, focuses, selectedId, true, effectiveStyle, viewport);
  }, [callouts, effectiveStyle, focuses, ready, selectedId, viewport.height, viewport.width, viewport.x, viewport.y]);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context || !ready || !calloutsRef.current.length) return;
    setCallouts(calloutsRef.current.map((callout) => {
      const measured = measureCalloutForText(context, callout.text, capture.width - callout.x, effectiveStyle);
      const width = Math.min(
        capture.width,
        callout.manualWidth ?? Math.max(callout.minimumWidth ?? 0, measured.width)
      );
      const height = Math.min(
        capture.height,
        measureCalloutHeightForWidth(context, callout.text, width, effectiveStyle)
      );
      return {
        ...callout,
        x: Math.max(0, Math.min(callout.x, capture.width - width)),
        y: Math.max(0, Math.min(callout.y, capture.height - height)),
        width,
        height
      };
    }));
  }, [capture.height, capture.width, effectiveStyle, ready, setCallouts]);

  const undo = useCallback(() => {
    setPast((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((next) => [currentSnapshot(), ...next]);
      applySnapshot(previous);
      setSelectedId(null);
      setEditingId(null);
      return items.slice(0, -1);
    });
  }, [applySnapshot]);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setPast((previous) => [...previous, currentSnapshot()]);
      applySnapshot(next);
      setSelectedId(null);
      setEditingId(null);
      return items.slice(1);
    });
  }, [applySnapshot]);

  const zoomOut = () => {
    const next = [...ZOOM_LEVELS].reverse().find((level) => level < displayScale - 0.001);
    setZoom(next ?? ZOOM_LEVELS[0]);
  };

  const zoomIn = () => {
    const next = ZOOM_LEVELS.find((level) => level > displayScale + 0.001);
    setZoom(next ?? ZOOM_LEVELS.at(-1)!);
  };

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop
    };
    setPanning(true);
  };

  const continuePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const workspace = workspaceRef.current;
    if (!pan || !workspace || pan.pointerId !== event.pointerId) return;
    workspace.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    workspace.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const workspace = workspaceRef.current;
    if (!pan || !workspace || pan.pointerId !== event.pointerId) return;
    if (workspace.hasPointerCapture(event.pointerId)) workspace.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setPanning(false);
  };

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    const before = currentSnapshot();
    setCallouts(calloutsRef.current.filter((callout) => callout.id !== selectedId));
    setFocuses(focusesRef.current.filter((focus) => focus.id !== selectedId));
    record(before);
    setSelectedId(null);
    setEditingId(null);
  }, [record, selectedId, setCallouts, setFocuses]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (cropRect) {
        if (event.key === "Escape") {
          cropDragRef.current = null;
          setCropRect(null);
        }
        return;
      }
      const target = event.target as HTMLElement;
      const typing = target.tagName === "TEXTAREA" || target.tagName === "INPUT";
      if (event.key === "Escape") {
        setEditingId(null);
        setSelectedId(null);
      }
      if (!typing && (event.key === "Delete" || event.key === "Backspace")) removeSelected();
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cropRect, redo, removeSelected, undo]);

  const pointFromEvent = (event: {
    currentTarget: HTMLCanvasElement;
    clientX: number;
    clientY: number;
  }): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: viewport.x + ((event.clientX - rect.left) / rect.width) * viewport.width,
      y: viewport.y + ((event.clientY - rect.top) / rect.height) * viewport.height
    };
  };

  const updateOne = (id: string, transform: (callout: Callout) => Callout) => {
    setCallouts(calloutsRef.current.map((callout) => (callout.id === id ? transform(callout) : callout)));
  };

  const updateFocus = (id: string, transform: (focus: FocusRegion) => FocusRegion) => {
    setFocuses(focusesRef.current.map((focus) => (focus.id === id ? transform(focus) : focus)));
  };

  const updateTextAndFit = (id: string, text: string) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) {
      updateOne(id, (callout) => ({ ...callout, text }));
      return;
    }
    updateOne(id, (callout) => {
      const measured = measureCalloutForText(context, text, viewportRight - callout.x, effectiveStyle);
      const width = Math.min(
        viewport.width,
        callout.manualWidth ?? Math.max(callout.minimumWidth ?? 0, measured.width)
      );
      const height = Math.min(
        viewport.height,
        measureCalloutHeightForWidth(context, text, width, effectiveStyle)
      );
      return {
        ...callout,
        text,
        x: Math.max(viewport.x, Math.min(callout.x, viewportRight - width)),
        y: Math.max(viewport.y, Math.min(callout.y, viewportBottom - height)),
        width,
        height
      };
    });
  };

  const visibleCanvasCenter = () => {
    const canvas = canvasRef.current;
    const workspace = workspaceRef.current;
    let centerX = viewport.x + viewport.width / 2;
    let centerY = viewport.y + viewport.height / 2;
    if (canvas && workspace) {
      const canvasRect = canvas.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      const visibleLeft = Math.max(canvasRect.left, workspaceRect.left);
      const visibleRight = Math.min(canvasRect.right, workspaceRect.right);
      const visibleTop = Math.max(canvasRect.top, workspaceRect.top);
      const visibleBottom = Math.min(canvasRect.bottom, workspaceRect.bottom);
      if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
        centerX = viewport.x + (((visibleLeft + visibleRight) / 2 - canvasRect.left) / canvasRect.width) * viewport.width;
        centerY = viewport.y + (((visibleTop + visibleBottom) / 2 - canvasRect.top) / canvasRect.height) * viewport.height;
      }
    }
    return { x: centerX, y: centerY };
  };

  const addCallout = () => {
    const context = canvasRef.current?.getContext("2d");
    const width = Math.min(
      Math.max(minCalloutWidth(effectiveStyle), 360 * effectiveStyle.calloutScale),
      viewport.width
    );
    const height = Math.min(
      context
        ? measureCalloutHeightForWidth(context, "", width, effectiveStyle)
        : minCalloutHeight(effectiveStyle),
      viewport.height
    );
    const center = visibleCanvasCenter();

    const x = Math.max(viewport.x, Math.min(viewportRight - width, center.x - width / 2));
    const y = Math.max(viewport.y, Math.min(viewportBottom - height, center.y - height / 2));
    const targetX = x + width + 120 <= viewportRight ? x + width + 120 : Math.max(viewport.x, x - 120);
    const targetY = y + height + 80 <= viewportBottom ? y + height + 80 : Math.max(viewport.y, y - 80);
    const id = crypto.randomUUID();
    const before = currentSnapshot();
    setCallouts([
      ...calloutsRef.current,
      { id, x, y, width, height, text: "", targetX, targetY, minimumWidth: width }
    ]);
    setSelectedId(id);
    setEditingId(id);
    record(before);
  };

  const addFocus = () => {
    const width = Math.min(420, viewport.width);
    const height = Math.min(240, viewport.height);
    const center = visibleCanvasCenter();
    const focus: FocusRegion = {
      id: crypto.randomUUID(),
      x: Math.max(viewport.x, Math.min(viewportRight - width, center.x - width / 2)),
      y: Math.max(viewport.y, Math.min(viewportBottom - height, center.y - height / 2)),
      width,
      height
    };
    const before = currentSnapshot();
    setFocuses([...focusesRef.current, focus]);
    setSelectedId(focus.id);
    setEditingId(null);
    record(before);
  };

  const startCrop = () => {
    setCropRect(cloneCrop(cropRef.current) ?? { ...fullViewport });
    setSelectedId(null);
    setEditingId(null);
  };

  const cancelCrop = () => {
    cropDragRef.current = null;
    setCropRect(null);
  };

  const applyCrop = () => {
    if (!cropRect) return;
    const x = Math.max(0, Math.floor(cropRect.x));
    const y = Math.max(0, Math.floor(cropRect.y));
    const width = Math.max(1, Math.min(capture.width - x, Math.round(cropRect.width)));
    const height = Math.max(1, Math.min(capture.height - y, Math.round(cropRect.height)));
    const before = currentSnapshot();
    const nextCrop = x === 0 && y === 0 && width === capture.width && height === capture.height
      ? null
      : { x, y, width, height };
    setCrop(nextCrop);
    setCropRect(null);
    setZoom(null);
    record(before);
  };

  const calloutHandleAt = (point: Point, callout: Callout): CalloutResizeHandle | null => {
    const tolerance = Math.max(10, 9 / cssScale);
    const handles: [CalloutResizeHandle, Point][] = [
      ["w", { x: callout.x, y: callout.y + callout.height / 2 }],
      ["e", { x: callout.x + callout.width, y: callout.y + callout.height / 2 }]
    ];
    return handles.find(([, handle]) => distance(point, handle) <= tolerance)?.[0] ?? null;
  };

  const focusHandleAt = (point: Point, focus: FocusRegion | CropRegion): FocusResizeHandle | null => {
    const tolerance = Math.max(10, 9 / cssScale);
    const centerX = focus.x + focus.width / 2;
    const centerY = focus.y + focus.height / 2;
    const handles: [FocusResizeHandle, Point][] = [
      ["nw", { x: focus.x, y: focus.y }],
      ["n", { x: centerX, y: focus.y }],
      ["ne", { x: focus.x + focus.width, y: focus.y }],
      ["w", { x: focus.x, y: centerY }],
      ["e", { x: focus.x + focus.width, y: centerY }],
      ["sw", { x: focus.x, y: focus.y + focus.height }],
      ["s", { x: centerX, y: focus.y + focus.height }],
      ["se", { x: focus.x + focus.width, y: focus.y + focus.height }]
    ];
    return handles.find(([, handle]) => distance(point, handle) <= tolerance)?.[0] ?? null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    if (editingId) setEditingId(null);
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (cropRect) {
      const handle = focusHandleAt(point, cropRect);
      if (handle) cropDragRef.current = { kind: "resize", handle, original: { ...cropRect } };
      else if (pointInFocus(point, cropRect)) {
        cropDragRef.current = { kind: "move", start: point, original: { ...cropRect } };
      }
      return;
    }

    const before = currentSnapshot();

    if (selectedCallout) {
      const handle = calloutHandleAt(point, selectedCallout);
      if (handle) {
        dragRef.current = { kind: "resize-callout", id: selectedCallout.id, handle, original: { ...selectedCallout }, before };
        return;
      }
      if (distance(point, { x: selectedCallout.targetX, y: selectedCallout.targetY }) <= Math.max(15, 12 / cssScale)) {
        dragRef.current = { kind: "target", id: selectedCallout.id, before };
        return;
      }
    }
    if (selectedFocus) {
      const handle = focusHandleAt(point, selectedFocus);
      if (handle) {
        dragRef.current = { kind: "resize-focus", id: selectedFocus.id, handle, original: { ...selectedFocus }, before };
        return;
      }
    }

    const calloutHit = [...calloutsRef.current].reverse().find((callout) => pointInCallout(point, callout));
    if (calloutHit) {
      setSelectedId(calloutHit.id);
      dragRef.current = { kind: "move-callout", id: calloutHit.id, start: point, original: { ...calloutHit }, before };
      return;
    }
    const focusHit = [...focusesRef.current].reverse().find((focus) => pointInFocus(point, focus));
    if (focusHit) {
      setSelectedId(focusHit.id);
      dragRef.current = { kind: "move-focus", id: focusHit.id, start: point, original: { ...focusHit }, before };
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const cropDrag = cropDragRef.current;
    if (cropDrag && cropRect && event.currentTarget.hasPointerCapture(event.pointerId)) {
      const point = pointFromEvent(event);
      if (cropDrag.kind === "move") {
        const dx = point.x - cropDrag.start.x;
        const dy = point.y - cropDrag.start.y;
        setCropRect({
          ...cropRect,
          x: Math.max(0, Math.min(capture.width - cropDrag.original.width, cropDrag.original.x + dx)),
          y: Math.max(0, Math.min(capture.height - cropDrag.original.height, cropDrag.original.y + dy))
        });
      } else {
        const minimumWidth = Math.min(32, capture.width);
        const minimumHeight = Math.min(32, capture.height);
        let left = cropDrag.original.x;
        let top = cropDrag.original.y;
        let right = cropDrag.original.x + cropDrag.original.width;
        let bottom = cropDrag.original.y + cropDrag.original.height;
        if (cropDrag.handle.includes("w")) left = Math.max(0, Math.min(point.x, right - minimumWidth));
        if (cropDrag.handle.includes("e")) right = Math.min(capture.width, Math.max(point.x, left + minimumWidth));
        if (cropDrag.handle.includes("n")) top = Math.max(0, Math.min(point.y, bottom - minimumHeight));
        if (cropDrag.handle.includes("s")) bottom = Math.min(capture.height, Math.max(point.y, top + minimumHeight));
        setCropRect({ ...cropRect, x: left, y: top, width: right - left, height: bottom - top });
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointFromEvent(event);

    if (drag.kind === "target") {
      updateOne(drag.id, (callout) => ({
        ...callout,
        targetX: Math.max(viewport.x, Math.min(viewportRight, point.x)),
        targetY: Math.max(viewport.y, Math.min(viewportBottom, point.y))
      }));
      return;
    }
    if (drag.kind === "move-callout") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      updateOne(drag.id, (callout) => ({
        ...callout,
        x: Math.max(viewport.x, Math.min(viewportRight - callout.width, drag.original.x + dx)),
        y: Math.max(viewport.y, Math.min(viewportBottom - callout.height, drag.original.y + dy))
      }));
      return;
    }
    if (drag.kind === "move-focus") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      updateFocus(drag.id, (focus) => ({
        ...focus,
        x: Math.max(viewport.x, Math.min(viewportRight - focus.width, drag.original.x + dx)),
        y: Math.max(viewport.y, Math.min(viewportBottom - focus.height, drag.original.y + dy))
      }));
      return;
    }

    if (drag.kind === "resize-focus") {
      const minimumWidth = Math.min(MIN_FOCUS_SIZE, viewport.width);
      const minimumHeight = Math.min(MIN_FOCUS_SIZE, viewport.height);
      let left = drag.original.x;
      let top = drag.original.y;
      let right = drag.original.x + drag.original.width;
      let bottom = drag.original.y + drag.original.height;
      if (drag.handle.includes("w")) left = Math.max(viewport.x, Math.min(point.x, right - minimumWidth));
      if (drag.handle.includes("e")) right = Math.min(viewportRight, Math.max(point.x, left + minimumWidth));
      if (drag.handle.includes("n")) top = Math.max(viewport.y, Math.min(point.y, bottom - minimumHeight));
      if (drag.handle.includes("s")) bottom = Math.min(viewportBottom, Math.max(point.y, top + minimumHeight));
      updateFocus(drag.id, (focus) => ({
        ...focus,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      }));
      return;
    }

    // Callouts intentionally resize horizontally; their height remains text-derived.
    const context = canvasRef.current?.getContext("2d");
    const right = drag.original.x + drag.original.width;
    const minimumWidth = Math.min(minCalloutWidth(effectiveStyle), viewport.width);
    let x = drag.original.x;
    let width = drag.original.width;
    if (drag.handle === "w") {
      x = Math.max(viewport.x, Math.min(point.x, right - minimumWidth));
      width = right - x;
    }
    if (drag.handle === "e") width = Math.max(minimumWidth, point.x - x);
    width = Math.min(width, viewportRight - x);
    const height = Math.min(
      viewport.height,
      context
        ? measureCalloutHeightForWidth(context, drag.original.text, width, effectiveStyle)
        : drag.original.height
    );
    const y = Math.max(viewport.y, Math.min(drag.original.y, viewportBottom - height));
    updateOne(drag.id, (callout) => ({
      ...callout,
      x,
      y,
      width,
      height,
      manualWidth: width
    }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (cropDragRef.current) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      cropDragRef.current = null;
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    record(drag.before);
    dragRef.current = null;
  };

  const exportImage = async (settings: SaveSettings) => {
    const image = imageRef.current;
    if (!image) return;
    const exportViewport = cropRef.current ?? fullViewport;
    const maxWidth = Math.max(0, Math.floor(Number(settings.maxWidth) || 0));
    const maxHeight = Math.max(0, Math.floor(Number(settings.maxHeight) || 0));
    const exportScale = Math.min(
      1,
      maxWidth > 0 ? maxWidth / exportViewport.width : 1,
      maxHeight > 0 ? maxHeight / exportViewport.height : 1
    );
    const exportWidth = Math.max(1, Math.round(exportViewport.width * exportScale));
    const exportHeight = Math.max(1, Math.round(exportViewport.height * exportScale));

    setFormat(settings.format);
    setMaxWidthInput(settings.maxWidth);
    setMaxHeightInput(settings.maxHeight);
    localStorage.setItem(SAVE_FORMAT_KEY, settings.format);
    if (settings.maxWidth) localStorage.setItem(SAVE_MAX_WIDTH_KEY, settings.maxWidth);
    else localStorage.removeItem(SAVE_MAX_WIDTH_KEY);
    if (settings.maxHeight) localStorage.setItem(SAVE_MAX_HEIGHT_KEY, settings.maxHeight);
    else localStorage.removeItem(SAVE_MAX_HEIGHT_KEY);
    setExportDialogOpen(false);
    setExporting(true);
    try {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = exportViewport.width;
      sourceCanvas.height = exportViewport.height;
      const context = sourceCanvas.getContext("2d")!;
      if (settings.format === "jpeg") {
        context.fillStyle = "white";
        context.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      }
      drawScene(context, image, calloutsRef.current, focusesRef.current, null, false, captureStyle, exportViewport);
      const outputCanvas = exportScale < 1 ? document.createElement("canvas") : sourceCanvas;
      if (outputCanvas !== sourceCanvas) {
        outputCanvas.width = exportWidth;
        outputCanvas.height = exportHeight;
        const outputContext = outputCanvas.getContext("2d")!;
        outputContext.imageSmoothingEnabled = true;
        outputContext.imageSmoothingQuality = "high";
        outputContext.drawImage(sourceCanvas, 0, 0, exportWidth, exportHeight);
      }
      const dataUrl = outputCanvas.toDataURL(settings.format === "png" ? "image/png" : "image/jpeg", 0.92);
      await onExport(dataUrl, settings.format);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="editor-shell">
      <div className="editor-toolbar">
        <div className="tool-group">
          <button disabled={Boolean(cropRect)} onClick={addCallout} title="Add a callout">
            <ChatCenteredText size={17} weight="bold" /> Callout
          </button>
          <button disabled={Boolean(cropRect)} onClick={addFocus} title="Add a focus region">
            <FrameCorners size={17} weight="bold" /> Focus
          </button>
          <button
            className={cropRect || crop ? "active" : ""}
            onClick={cropRect ? cancelCrop : startCrop}
            title={crop ? "Edit crop using the original image" : "Crop capture"}
          >
            <Crop size={17} weight="bold" /> {crop && !cropRect ? "Edit crop" : "Crop"}
          </button>
        </div>
        <div className="tool-separator" />
        <div className="tool-group compact">
          <button disabled={Boolean(cropRect) || !past.length} onClick={undo} title="Undo (Ctrl+Z)"><ArrowCounterClockwise size={17} /></button>
          <button disabled={Boolean(cropRect) || !future.length} onClick={redo} title="Redo (Ctrl+Y)"><ArrowClockwise size={17} /></button>
          <button disabled={Boolean(cropRect) || !selectedId} onClick={removeSelected} title="Delete selected"><Trash size={17} /></button>
        </div>
        {cropRect && (
          <>
            <div className="tool-separator" />
            <span className="crop-size">{Math.round(cropRect.width)} × {Math.round(cropRect.height)}</span>
            <div className="tool-group crop-actions">
              <button onClick={cancelCrop}><XCircle size={16} /> Cancel</button>
              <button className="apply-crop-button" onClick={applyCrop}><Check size={16} weight="bold" /> Apply crop</button>
            </div>
          </>
        )}
        <div className="editor-toolbar-spacer" />
        <span className="image-size">{Math.round(viewport.width)} × {Math.round(viewport.height)}</span>
        <div className="tool-group document-actions">
          <button
            className={replacementArmed ? "active" : ""}
            disabled={Boolean(cropRect) || documentSaving}
            onClick={onReplace}
            title={replacementArmed ? "Cancel capture replacement" : "Replace the original capture and preserve edits"}
          >
            <ArrowClockwise size={17} weight="bold" /> {replacementArmed ? "Cancel replace" : "Replace"}
          </button>
          <button className="document-save-button" disabled={documentSaving} onClick={() => void onSaveDocument(currentSnapshot(), false)} title="Save editable CapSage document">
            <FloppyDisk size={17} weight="bold" /> {documentSaving ? "Saving…" : "Save"}
          </button>
          {canSaveAs && (
            <button className="document-save-as-button" disabled={documentSaving} onClick={() => void onSaveDocument(currentSnapshot(), true)} title="Save editable document as…">
              Save as…
            </button>
          )}
        </div>
        <button className="save-button" disabled={exporting} onClick={() => setExportDialogOpen(true)}>
          <DownloadSimple size={17} weight="bold" /> {exporting ? "Exporting…" : "Export"}
        </button>
      </div>
      <div className="editor-workspace-frame">
        <div
          ref={workspaceRef}
          className={`editor-workspace tool-select ${cropRect ? "cropping" : ""} ${panning ? "panning" : ""}`}
          onPointerDownCapture={beginPan}
          onPointerMove={continuePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onAuxClick={(event) => event.preventDefault()}
          onPointerDown={() => editingId && setEditingId(null)}
        >
        <div className="canvas-scroll-area">
          <div
            className="canvas-stage"
            style={{ width: viewport.width * cssScale, height: viewport.height * cssScale }}
          >
            <canvas
              ref={canvasRef}
              width={viewport.width}
              height={viewport.height}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={(event) => {
                if (cropRect) return;
                const point = pointFromEvent(event);
                const hit = [...calloutsRef.current].reverse().find((callout) => pointInCallout(point, callout));
                if (hit) {
                  setSelectedId(hit.id);
                  setEditingId(hit.id);
                }
              }}
            />
            {cropRect && (
              <div className="crop-mask" aria-hidden="true">
                <div
                  className="crop-frame"
                  style={{
                    left: (cropRect.x - viewport.x) * cssScale,
                    top: (cropRect.y - viewport.y) * cssScale,
                    width: cropRect.width * cssScale,
                    height: cropRect.height * cssScale
                  }}
                >
                  {(["nw", "n", "ne", "w", "e", "sw", "s", "se"] as FocusResizeHandle[]).map((handle) => (
                    <i key={handle} className={`crop-handle crop-handle-${handle}`} />
                  ))}
                </div>
              </div>
            )}
            {editingId && selectedCallout && (
              <textarea
                autoFocus
                className="callout-text-editor"
                value={selectedCallout.text}
                placeholder="Callout text"
                style={{
                  left: (selectedCallout.x - viewport.x + effectiveCalloutPaddingX) * cssScale,
                  top: (selectedCallout.y - viewport.y + effectiveCalloutPaddingY) * cssScale,
                  width: Math.max(30, (selectedCallout.width - effectiveCalloutPaddingX * 2) * cssScale),
                  height: Math.max(24, (selectedCallout.height - effectiveCalloutPaddingY * 2) * cssScale),
                  color: effectiveStyle.textColor,
                  backgroundColor: effectiveStyle.backgroundColor,
                  fontFamily: effectiveStyle.fontFamily,
                  fontSize: calloutFontSize(effectiveStyle) * cssScale,
                  lineHeight: `${captureStyleLineHeight(effectiveStyle) * cssScale}px`,
                  outlineColor: effectiveStyle.borderColor
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onFocus={() => { textBeforeRef.current = currentSnapshot(); }}
                onChange={(event) => updateTextAndFit(selectedCallout.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                onBlur={() => {
                  if (textBeforeRef.current) record(textBeforeRef.current);
                  textBeforeRef.current = null;
                  setEditingId(null);
                }}
              />
            )}
          </div>
          </div>
        </div>
        <div className="canvas-zoom-control" role="group" aria-label="Capture zoom">
          <button onClick={zoomIn} title="Zoom in" aria-label="Zoom in"><Plus size={16} /></button>
          <button
            className={`canvas-zoom-value ${zoom === null ? "fit" : ""}`}
            onClick={() => setZoom(null)}
            title={`Fit to window (${Math.round(fitScale * 100)}%). Middle-drag or use the scrollbars to pan.`}
            aria-label={`Zoom ${Math.round(displayScale * 100)} percent; click to fit`}
          >
            {Math.round(displayScale * 100)}%
          </button>
          <button onClick={zoomOut} title="Zoom out" aria-label="Zoom out"><Minus size={16} /></button>
        </div>
      </div>
      {exportDialogOpen && (
        <SaveDialog
          settings={{ format, maxWidth: maxWidthInput, maxHeight: maxHeightInput }}
          sourceWidth={crop?.width ?? capture.width}
          sourceHeight={crop?.height ?? capture.height}
          onCancel={() => setExportDialogOpen(false)}
          onSave={(settings) => void exportImage(settings)}
        />
      )}
    </section>
  );
}
