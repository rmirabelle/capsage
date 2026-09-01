import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, DotsSix, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";

const selectorWindow = getCurrentWindow();
const resizeHandles: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: "NorthWest", className: "handle-nw" },
  { direction: "North", className: "handle-n" },
  { direction: "NorthEast", className: "handle-ne" },
  { direction: "East", className: "handle-e" },
  { direction: "SouthEast", className: "handle-se" },
  { direction: "South", className: "handle-s" },
  { direction: "SouthWest", className: "handle-sw" },
  { direction: "West", className: "handle-w" }
];

export function DesktopRegionSelector() {
  const completedRef = useRef(false);
  const finishRef = useRef<() => Promise<void>>(async () => {});
  const [finishing, setFinishing] = useState(false);
  const [size, setSize] = useState(() => {
    const scaleFactor = window.devicePixelRatio || 1;
    return {
      width: Math.round(window.innerWidth * scaleFactor),
      height: Math.round(window.innerHeight * scaleFactor)
    };
  });

  const closeWithError = async (payload: string) => {
    if (completedRef.current) return;
    completedRef.current = true;
    await emit("region-selection-error", payload);
    await selectorWindow.close();
  };

  const cancel = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    void invoke("cancel_region_selection").catch(() => selectorWindow.close());
  };

  useEffect(() => {
    let disposed = false;
    let stopResize: (() => void) | undefined;

    const activate = async () => {
      try {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        if (disposed) return;
        await invoke("activate_region_selector");
      } catch (error) {
        void closeWithError(String(error));
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
      if (event.key === "Enter" && !event.repeat) {
        event.preventDefault();
        void finishRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    void selectorWindow.outerSize()
      .then((nativeSize) => {
        if (!disposed) setSize({ width: nativeSize.width, height: nativeSize.height });
      })
      .catch(() => {});
    void selectorWindow.onResized(({ payload: nativeSize }) => {
      if (!disposed) setSize({ width: nativeSize.width, height: nativeSize.height });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopResize = unlisten;
    }).catch(() => {});
    void activate();

    return () => {
      disposed = true;
      stopResize?.();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const finish = async () => {
    if (finishing || completedRef.current) return;
    setFinishing(true);
    try {
      await invoke("capture_selector_region");
    } catch (error) {
      if (completedRef.current) return;
      setFinishing(false);
      void closeWithError(String(error));
    }
  };
  finishRef.current = finish;

  const beginResize = (event: ReactPointerEvent, direction: ResizeDirection) => {
    event.preventDefault();
    event.stopPropagation();
    void selectorWindow.startResizeDragging(direction);
  };

  return (
    <main
      className={`bounded-selector ${finishing ? "finishing" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <div className="bounded-selector-drag-surface" data-tauri-drag-region />
      <div className="bounded-selector-toolbar">
        <div className="selector-drag-grip" data-tauri-drag-region title="Drag to move selection">
          <DotsSix size={17} weight="bold" />
        </div>
        <div className="bounded-selector-copy" data-tauri-drag-region>
          <strong data-tauri-drag-region>Capture area</strong>
          <span data-tauri-drag-region>{Math.round(size.width)} × {Math.round(size.height)} · Drag to move · Resize any edge</span>
        </div>
        <button
          className="selector-cancel"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }}
        >
          <X size={15} /> <span className="button-label">Cancel</span>
        </button>
        <button className="selector-confirm" onClick={() => void finish()} disabled={finishing}>
          <Check size={15} weight="bold" /> <span className="button-label">{finishing ? "Capturing…" : "Capture"}</span>
        </button>
      </div>
      {resizeHandles.map(({ direction, className }) => (
        <span
          key={direction}
          className={`selector-handle ${className}`}
          onPointerDown={(event) => beginResize(event, direction)}
        />
      ))}
    </main>
  );
}
