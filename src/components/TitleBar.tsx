import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowClockwise, DownloadSimple, Info } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { WindowControls } from "./WindowControls";

interface Props {
  updateAvailable: boolean;
  onAbout: () => void;
}

export function TitleBar({ updateAvailable, onAbout }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) setHelpOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [helpOpen]);

  const openAbout = () => {
    setHelpOpen(false);
    onAbout();
  };

  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => isTauri() && getCurrentWindow().toggleMaximize()}
    >
      <div className="brand" data-tauri-drag-region>
        <img src="/icon.ico" alt="" />
        <span>CapSage</span>
      </div>
      <nav className="titlebar-menu" aria-label="Application menu">
        <div className="titlebar-menu-root" ref={helpRef}>
          <button className={helpOpen ? "active" : ""} onClick={() => setHelpOpen((open) => !open)}>Help</button>
          {helpOpen && (
            <div className="titlebar-menu-dropdown">
              <button onClick={openAbout}>
                <span><ArrowClockwise size={15} /> Check for Updates…</span>
              </button>
              <div className="titlebar-menu-divider" />
              <button onClick={openAbout}>
                <span><Info size={15} /> About CapSage</span>
              </button>
            </div>
          )}
        </div>
        {updateAvailable && (
          <button className="titlebar-update-button" onClick={onAbout} title="A new CapSage version is available">
            <DownloadSimple size={14} weight="bold" /> Update available
          </button>
        )}
      </nav>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <WindowControls />
    </header>
  );
}
