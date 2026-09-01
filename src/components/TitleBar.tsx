import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowClockwise, DownloadSimple, FolderOpen, Info } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { WindowControls } from "./WindowControls";

interface Props {
  updateAvailable: boolean;
  documentLabel: string | null;
  documentDirty: boolean;
  onOpen: () => void;
  onAbout: () => void;
}

export function TitleBar({ updateAvailable, documentLabel, documentDirty, onOpen, onAbout }: Props) {
  const [openMenu, setOpenMenu] = useState<"file" | "help" | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const openFile = () => {
    setOpenMenu(null);
    onOpen();
  };

  const openAbout = () => {
    setOpenMenu(null);
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
      <nav ref={menuRef} className="titlebar-menu" aria-label="Application menu">
        <div className="titlebar-menu-root">
          <button className={openMenu === "file" ? "active" : ""} onClick={() => setOpenMenu((menu) => menu === "file" ? null : "file")}>File</button>
          {openMenu === "file" && (
            <div className="titlebar-menu-dropdown">
              <button onClick={openFile}>
                <span><FolderOpen size={15} /> Open…</span>
              </button>
            </div>
          )}
        </div>
        <div className="titlebar-menu-root">
          <button className={openMenu === "help" ? "active" : ""} onClick={() => setOpenMenu((menu) => menu === "help" ? null : "help")}>Help</button>
          {openMenu === "help" && (
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
      {documentLabel && (
        <span className="titlebar-document" data-tauri-drag-region>
          {documentLabel}{documentDirty ? " *" : ""}
        </span>
      )}
      <div className="titlebar-spacer" data-tauri-drag-region />
      <WindowControls />
    </header>
  );
}
