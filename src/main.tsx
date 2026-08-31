import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { DesktopRegionSelector } from "./components/DesktopRegionSelector";
import { TrayMenu } from "./components/TrayMenu";
import "./index.css";

const windowLabel = getCurrentWindow().label;
const isRegionSelector = windowLabel === "region-selector";
const isTrayMenu = windowLabel === "tray-menu";
if (isRegionSelector) document.documentElement.classList.add("region-selector-document");
if (isTrayMenu) document.documentElement.classList.add("tray-menu-document");
createRoot(document.getElementById("root")!).render(
  isRegionSelector ? <DesktopRegionSelector /> : isTrayMenu ? <TrayMenu /> : <App />
);
