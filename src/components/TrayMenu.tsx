import { ArrowSquareOut, Camera, Power } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

export function TrayMenu() {
  useEffect(() => {
    let active = false;
    let stopFocusListener: (() => void) | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void invoke("close_tray_menu");
    };
    window.addEventListener("keydown", onKeyDown);

    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (active && !focused) void invoke("close_tray_menu");
    }).then((stop) => {
      stopFocusListener = stop;
      return invoke("activate_tray_menu");
    }).then(() => {
      active = true;
    });

    return () => {
      active = false;
      stopFocusListener?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <main className="tray-menu-shell" onContextMenu={(event) => event.preventDefault()}>
      <header className="tray-menu-brand">
        <span><Camera size={16} weight="duotone" /></span>
        <strong>CapSage</strong>
        <small>Ready to capture</small>
      </header>
      <button type="button" onClick={() => void invoke("show_capsage")}>
        <ArrowSquareOut size={17} />
        <span>Open CapSage</span>
      </button>
      <div className="tray-menu-separator" />
      <button className="tray-menu-exit" type="button" onClick={() => void invoke("exit_capsage")}>
        <Power size={17} />
        <span>Exit CapSage</span>
      </button>
    </main>
  );
}
