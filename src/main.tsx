import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { DesktopRegionSelector } from "./components/DesktopRegionSelector";
import { SplashScreen } from "./components/SplashScreen";
import { TrayMenu } from "./components/TrayMenu";
import "./index.css";

const windowLabel = getCurrentWindow().label;
const isRegionSelector = windowLabel === "region-selector";
const isSplash = windowLabel === "splash";
const isTrayMenu = windowLabel === "tray-menu";
if (isRegionSelector) document.documentElement.classList.add("region-selector-document");
if (isSplash) document.documentElement.classList.add("splash-document");
if (isTrayMenu) document.documentElement.classList.add("tray-menu-document");
createRoot(document.getElementById("root")!).render(
  isRegionSelector
    ? <DesktopRegionSelector />
    : isSplash
      ? <SplashScreen />
      : isTrayMenu
        ? <TrayMenu />
        : <App />
);
