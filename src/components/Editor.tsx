import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ChatCenteredText,
  Check,
  Crop,
  FloppyDisk,
  FrameCorners,
  Minus,
  Plus,
  Trash,
  Warning,
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
import type { Callout, CaptureResult, FocusRegion, Point } from "../editor/types";
import { SaveDialog, type SaveFormat, type SaveSettings } from "./SaveDialog";

type CalloutResizeHandle = "w" | "e";
type FocusResizeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
type EditorSnapshot = { callouts: Callout[]; focuses: FocusRegion[] };
type PanState = { pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number };
type CropDragState =
  | { kind: "move"; start: Point; original: FocusRegion }
  | { kind: "resize"; handle: FocusResizeHandle; original: FocusRegion };
type PendingCrop = EditorSnapshot & { dataUrl: string };
type DragState =
  | { kind: "move-callout"; id: string; start: Point; original: Callout; before: EditorSnapshot }
  | { kind: "resize-callout"; id: string; handle: CalloutResizeHandle; original: Callout; before: EditorSnapshot }
  | { kind: "target"; id: string; before: EditorSnapshot }
  | { kind: "move-focus"; id: string; start: Point; original: FocusRegion; before: EditorSnapshot }
  | { kind: "resize-focus"; id: string; handle: FocusResizeHandle; original: FocusRegion; before: EditorSnapshot };

interface Props {
  capture: CaptureResult;
  captureStyle: CaptureStyle;
  onCrop: (capture: CaptureResult) => void;
  onSave: (dataUrl: string, format: "png" | "jpeg") => Promise<boolean>;
  onClear: () => void;
}

const cloneCallouts = (callouts: Callout[]) => callouts.map((callout) => ({ ...callout }));
const cloneFocuses = (focuses: FocusRegion[]) => focuses.map((focus) => ({ ...focus }));
const ZOOM_LEVELS = [0.05, 0.067, 0.1, 0.125, 0.16, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
const SAVE_FORMAT_KEY = "capsage.save-format";
const SAVE_MAX_WIDTH_KEY = "capsage.save-max-width";
const SAVE_MAX_HEIGHT_KEY = "capsage.save-max-height";
const cloneSnapshot = (snapshot: EditorSnapshot): EditorSnapshot => ({
  callouts: cloneCallouts(snapshot.callouts),
  focuses: cloneFocuses(snapshot.focuses)
});

export function Editor({ capture, captureStyle, onCrop, onSave, onClear }: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const calloutsRef = useRef<Callout[]>([]);
  const focusesRef = useRef<FocusRegion[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const cropDragRef = useRef<CropDragState | null>(null);
  const pendingCropRef = useRef<PendingCrop | null>(null);
  const panRef = useRef<PanState | null>(null);
  const textBeforeRef = useRef<EditorSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 900, height: 600 });
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);
  const [zoom, setZoom] = useState<number | null>(null);
  const [panning, setPanning] = useState(false);
  const [callouts, setCalloutsState] = useState<Callout[]>([]);
  const [focuses, setFocusesState] = useState<FocusRegion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [format, setFormat] = useState<SaveFormat>(() => localStorage.getItem(SAVE_FORMAT_KEY) === "jpeg" ? "jpeg" : "png");
  const [maxWidthInput, setMaxWidthInput] = useState(() => localStorage.getItem(SAVE_MAX_WIDTH_KEY) ?? "");
  const [maxHeightInput, setMaxHeightInput] = useState(() => localStorage.getItem(SAVE_MAX_HEIGHT_KEY) ?? "");
  const [saving, setSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [cropRect, setCropRect] = useState<FocusRegion | null>(null);

  const fitScale = Math.min(
    Math.max(0.05, ((workspaceSize.width - 48) * pixelRatio) / capture.width),
    Math.max(0.05, ((workspaceSize.height - 48) * pixelRatio) / capture.height),
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

  const currentSnapshot = (): EditorSnapshot => ({
    callouts: cloneCallouts(calloutsRef.current),
    focuses: cloneFocuses(focusesRef.current)
  });

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    setCallouts(cloneCallouts(snapshot.callouts));
    setFocuses(cloneFocuses(snapshot.focuses));
  }, [setCallouts, setFocuses]);

  const record = useCallback((before: EditorSnapshot) => {
    const current = { callouts: calloutsRef.current, focuses: focusesRef.current };
    if (JSON.stringify(before) === JSON.stringify(current)) return;
    setPast((items) => [...items, cloneSnapshot(before)].slice(-60));
    setFuture([]);
  }, []);

  useEffect(() => {
    const pendingCrop = pendingCropRef.current?.dataUrl === capture.dataUrl
      ? pendingCropRef.current
      : null;
    pendingCropRef.current = null;
    setReady(false);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setCallouts(pendingCrop ? cloneCallouts(pendingCrop.callouts) : []);
      setFocuses(pendingCrop ? cloneFocuses(pendingCrop.focuses) : []);
      setReady(true);
    };
    image.src = capture.dataUrl;
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setEditingId(null);
    setCropRect(null);
    setZoom(null);
  }, [capture.dataUrl, setCallouts, setFocuses]);

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
    drawScene(canvas.getContext("2d")!, image, callouts, focuses, selectedId, true, effectiveStyle);
  }, [callouts, effectiveStyle, focuses, ready, selectedId]);

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
      if (confirmingClear) {
        if (event.key === "Escape") setConfirmingClear(false);
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
  }, [confirmingClear, cropRect, redo, removeSelected, undo]);

  const pointFromEvent = (event: {
    currentTarget: HTMLCanvasElement;
    clientX: number;
    clientY: number;
  }): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * capture.width,
      y: ((event.clientY - rect.top) / rect.height) * capture.height
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
      const measured = measureCalloutForText(context, text, capture.width - callout.x, effectiveStyle);
      const width = Math.min(
        capture.width,
        callout.manualWidth ?? Math.max(callout.minimumWidth ?? 0, measured.width)
      );
      const height = Math.min(
        capture.height,
        measureCalloutHeightForWidth(context, text, width, effectiveStyle)
      );
      return {
        ...callout,
        text,
        x: Math.min(callout.x, capture.width - width),
        y: Math.min(callout.y, capture.height - height),
        width,
        height
      };
    });
  };

  const visibleCanvasCenter = () => {
    const canvas = canvasRef.current;
    const workspace = workspaceRef.current;
    let centerX = capture.width / 2;
    let centerY = capture.height / 2;
    if (canvas && workspace) {
      const canvasRect = canvas.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      const visibleLeft = Math.max(canvasRect.left, workspaceRect.left);
      const visibleRight = Math.min(canvasRect.right, workspaceRect.right);
      const visibleTop = Math.max(canvasRect.top, workspaceRect.top);
      const visibleBottom = Math.min(canvasRect.bottom, workspaceRect.bottom);
      if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
        centerX = (((visibleLeft + visibleRight) / 2 - canvasRect.left) / canvasRect.width) * capture.width;
        centerY = (((visibleTop + visibleBottom) / 2 - canvasRect.top) / canvasRect.height) * capture.height;
      }
    }
    return { x: centerX, y: centerY };
  };

  const addCallout = () => {
    const context = canvasRef.current?.getContext("2d");
    const width = Math.min(
      Math.max(minCalloutWidth(effectiveStyle), 360 * effectiveStyle.calloutScale),
      capture.width
    );
    const height = Math.min(
      context
        ? measureCalloutHeightForWidth(context, "", width, effectiveStyle)
        : minCalloutHeight(effectiveStyle),
      capture.height
    );
    const center = visibleCanvasCenter();

    const x = Math.max(0, Math.min(capture.width - width, center.x - width / 2));
    const y = Math.max(0, Math.min(capture.height - height, center.y - height / 2));
    const targetX = x + width + 120 <= capture.width ? x + width + 120 : Math.max(0, x - 120);
    const targetY = y + height + 80 <= capture.height ? y + height + 80 : Math.max(0, y - 80);
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
    const width = Math.min(420, capture.width);
    const height = Math.min(240, capture.height);
    const center = visibleCanvasCenter();
    const focus: FocusRegion = {
      id: crypto.randomUUID(),
      x: Math.max(0, Math.min(capture.width - width, center.x - width / 2)),
      y: Math.max(0, Math.min(capture.height - height, center.y - height / 2)),
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
    setCropRect({
      id: "crop-region",
      x: 0,
      y: 0,
      width: capture.width,
      height: capture.height
    });
    setSelectedId(null);
    setEditingId(null);
  };

  const cancelCrop = () => {
    cropDragRef.current = null;
    setCropRect(null);
  };

  const applyCrop = () => {
    const image = imageRef.current;
    if (!image || !cropRect) return;
    const x = Math.max(0, Math.floor(cropRect.x));
    const y = Math.max(0, Math.floor(cropRect.y));
    const width = Math.max(1, Math.min(capture.width - x, Math.round(cropRect.width)));
    const height = Math.max(1, Math.min(capture.height - y, Math.round(cropRect.height)));
    if (x === 0 && y === 0 && width === capture.width && height === capture.height) {
      cancelCrop();
      return;
    }

    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = width;
    croppedCanvas.height = height;
    croppedCanvas.getContext("2d")!.drawImage(image, x, y, width, height, 0, 0, width, height);
    const dataUrl = croppedCanvas.toDataURL("image/png");

    const nextCallouts = calloutsRef.current
      .filter((callout) =>
        callout.x < x + width && callout.x + callout.width > x &&
        callout.y < y + height && callout.y + callout.height > y)
      .map((callout) => {
        const nextWidth = Math.min(callout.width, width);
        const nextHeight = Math.min(callout.height, height);
        return {
          ...callout,
          x: Math.max(0, Math.min(width - nextWidth, callout.x - x)),
          y: Math.max(0, Math.min(height - nextHeight, callout.y - y)),
          width: nextWidth,
          height: nextHeight,
          targetX: Math.max(0, Math.min(width, callout.targetX - x)),
          targetY: Math.max(0, Math.min(height, callout.targetY - y)),
          ...(callout.minimumWidth === undefined ? {} : { minimumWidth: Math.min(callout.minimumWidth, nextWidth) }),
          ...(callout.manualWidth === undefined ? {} : { manualWidth: nextWidth })
        };
      });
    const nextFocuses = focusesRef.current.flatMap((focus) => {
      const left = Math.max(focus.x, x);
      const top = Math.max(focus.y, y);
      const right = Math.min(focus.x + focus.width, x + width);
      const bottom = Math.min(focus.y + focus.height, y + height);
      if (right <= left || bottom <= top) return [];
      return [{
        ...focus,
        x: left - x,
        y: top - y,
        width: right - left,
        height: bottom - top
      }];
    });

    pendingCropRef.current = { dataUrl, callouts: nextCallouts, focuses: nextFocuses };
    setReady(false);
    setCropRect(null);
    setZoom(null);
    onCrop({
      dataUrl,
      width,
      height,
      originX: capture.originX + x,
      originY: capture.originY + y
    });
  };

  const calloutHandleAt = (point: Point, callout: Callout): CalloutResizeHandle | null => {
    const tolerance = Math.max(10, 9 / cssScale);
    const handles: [CalloutResizeHandle, Point][] = [
      ["w", { x: callout.x, y: callout.y + callout.height / 2 }],
      ["e", { x: callout.x + callout.width, y: callout.y + callout.height / 2 }]
    ];
    return handles.find(([, handle]) => distance(point, handle) <= tolerance)?.[0] ?? null;
  };

  const focusHandleAt = (point: Point, focus: FocusRegion): FocusResizeHandle | null => {
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
        targetX: Math.max(0, Math.min(capture.width, point.x)),
        targetY: Math.max(0, Math.min(capture.height, point.y))
      }));
      return;
    }
    if (drag.kind === "move-callout") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      updateOne(drag.id, (callout) => ({
        ...callout,
        x: Math.max(0, Math.min(capture.width - callout.width, drag.original.x + dx)),
        y: Math.max(0, Math.min(capture.height - callout.height, drag.original.y + dy))
      }));
      return;
    }
    if (drag.kind === "move-focus") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      updateFocus(drag.id, (focus) => ({
        ...focus,
        x: Math.max(0, Math.min(capture.width - focus.width, drag.original.x + dx)),
        y: Math.max(0, Math.min(capture.height - focus.height, drag.original.y + dy))
      }));
      return;
    }

    if (drag.kind === "resize-focus") {
      const minimumWidth = Math.min(MIN_FOCUS_SIZE, capture.width);
      const minimumHeight = Math.min(MIN_FOCUS_SIZE, capture.height);
      let left = drag.original.x;
      let top = drag.original.y;
      let right = drag.original.x + drag.original.width;
      let bottom = drag.original.y + drag.original.height;
      if (drag.handle.includes("w")) left = Math.max(0, Math.min(point.x, right - minimumWidth));
      if (drag.handle.includes("e")) right = Math.min(capture.width, Math.max(point.x, left + minimumWidth));
      if (drag.handle.includes("n")) top = Math.max(0, Math.min(point.y, bottom - minimumHeight));
      if (drag.handle.includes("s")) bottom = Math.min(capture.height, Math.max(point.y, top + minimumHeight));
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
    const minimumWidth = Math.min(minCalloutWidth(effectiveStyle), capture.width);
    let x = drag.original.x;
    let width = drag.original.width;
    if (drag.handle === "w") {
      x = Math.min(point.x, right - minimumWidth);
      width = right - x;
    }
    if (drag.handle === "e") width = Math.max(minimumWidth, point.x - x);
    width = Math.min(width, capture.width - x);
    const height = Math.min(
      capture.height,
      context
        ? measureCalloutHeightForWidth(context, drag.original.text, width, effectiveStyle)
        : drag.original.height
    );
    const y = Math.max(0, Math.min(drag.original.y, capture.height - height));
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

  const save = async (settings: SaveSettings) => {
    const image = imageRef.current;
    if (!image) return;
    const maxWidth = Math.max(0, Math.floor(Number(settings.maxWidth) || 0));
    const maxHeight = Math.max(0, Math.floor(Number(settings.maxHeight) || 0));
    const exportScale = Math.min(
      1,
      maxWidth > 0 ? maxWidth / capture.width : 1,
      maxHeight > 0 ? maxHeight / capture.height : 1
    );
    const exportWidth = Math.max(1, Math.round(capture.width * exportScale));
    const exportHeight = Math.max(1, Math.round(capture.height * exportScale));

    setFormat(settings.format);
    setMaxWidthInput(settings.maxWidth);
    setMaxHeightInput(settings.maxHeight);
    localStorage.setItem(SAVE_FORMAT_KEY, settings.format);
    if (settings.maxWidth) localStorage.setItem(SAVE_MAX_WIDTH_KEY, settings.maxWidth);
    else localStorage.removeItem(SAVE_MAX_WIDTH_KEY);
    if (settings.maxHeight) localStorage.setItem(SAVE_MAX_HEIGHT_KEY, settings.maxHeight);
    else localStorage.removeItem(SAVE_MAX_HEIGHT_KEY);
    setSaveDialogOpen(false);
    setSaving(true);
    try {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = capture.width;
      sourceCanvas.height = capture.height;
      const context = sourceCanvas.getContext("2d")!;
      if (settings.format === "jpeg") {
        context.fillStyle = "white";
        context.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      }
      drawScene(context, image, calloutsRef.current, focusesRef.current, null, false, captureStyle);
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
      await onSave(dataUrl, settings.format);
    } finally {
      setSaving(false);
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
          <button className={cropRect ? "active" : ""} onClick={cropRect ? cancelCrop : startCrop} title="Crop capture">
            <Crop size={17} weight="bold" /> Crop
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
        <button className="clear-capture-button" onClick={() => setConfirmingClear(true)} title="Discard this capture">
          <XCircle size={17} /> <span>Clear capture</span>
        </button>
        <span className="image-size">{capture.width} × {capture.height}</span>
        <button className="save-button" disabled={saving} onClick={() => setSaveDialogOpen(true)}>
          <FloppyDisk size={17} weight="bold" /> {saving ? "Saving…" : "Save"}
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
            style={{ width: capture.width * cssScale, height: capture.height * cssScale }}
          >
            <canvas
              ref={canvasRef}
              width={capture.width}
              height={capture.height}
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
                    left: cropRect.x * cssScale,
                    top: cropRect.y * cssScale,
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
                  left: (selectedCallout.x + effectiveCalloutPaddingX) * cssScale,
                  top: (selectedCallout.y + effectiveCalloutPaddingY) * cssScale,
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
      {confirmingClear && (
        <div className="confirm-overlay" role="presentation" onPointerDown={() => setConfirmingClear(false)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-capture-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="confirm-icon"><Warning size={22} weight="fill" /></div>
            <div className="confirm-copy">
              <h2 id="clear-capture-title">Clear this capture?</h2>
              <p>The screenshot and any unsaved annotations will be discarded.</p>
            </div>
            <div className="confirm-actions">
              <button autoFocus className="button secondary" onClick={() => setConfirmingClear(false)}>Cancel</button>
              <button
                className="button danger"
                onClick={() => {
                  setConfirmingClear(false);
                  onClear();
                }}
              >
                Clear capture
              </button>
            </div>
          </div>
        </div>
      )}
      {saveDialogOpen && (
        <SaveDialog
          settings={{ format, maxWidth: maxWidthInput, maxHeight: maxHeightInput }}
          sourceWidth={capture.width}
          sourceHeight={capture.height}
          onCancel={() => setSaveDialogOpen(false)}
          onSave={(settings) => void save(settings)}
        />
      )}
    </section>
  );
}
