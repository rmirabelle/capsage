# CapSage

CapSage is a focused Windows screenshot and callout editor built with Tauri 2, React 19, TypeScript, and Rust.

Press the global capture shortcut from any application, capture the active window or select a live desktop region, add a clear text callout with an attached arrow, and save the finished image as PNG or JPEG.

## Current features

### Capture

- Configurable global shortcut (default: **Ctrl+Alt+Print Screen**)
- Persisted capture mode: **Active window** or **Screen region**
- Active-window capture through the native Windows drawing APIs
- Bounded live-desktop selection window that never covers or intercepts the rest of the desktop
- Immediately visible selection rectangle with native move and eight-handle resize interactions
- Explicit Capture and Cancel controls, plus Enter-to-capture and Escape/right-click/focus-loss cancellation
- Clear errors when the shortcut is unavailable or Windows cannot capture a target

### Editor

- Lossless, non-destructive source capture
- Auto-sizing, manually resizable rounded callout boxes with generously padded multiline text
- Moveable, freely resizable focus regions that blur and dim everything outside their rounded boundary
- Saved capture styles with live controls for annotation colors, borders, typography, and focus opacity
- Thick, filled and outlined one-way arrows attached automatically to the nearest box edge
- Draggable arrow targets
- Select, move, resize, edit, and delete interactions
- Undo and redo
- Fit-to-window display with adjustable zoom and scroll-based panning
- Native-resolution export independent of editor zoom

### Output

- PNG export
- JPEG export at 92% quality
- Native Windows Save As dialog
- Proportional downscaling by maximum width, height, or both
- Multi-resolution Windows app icon used by the window, tray, and installer

### Application

- Tray-only startup with single-click restore and styled tray menu
- Help menu and About dialog
- Silent update check on startup with in-app installer download and progress

## Run from source

```powershell
npm install
npm run tauri dev
```

Requirements:

- Windows 10 or Windows 11
- Node.js and npm
- Rust with the MSVC toolchain
- Tauri 2 Windows prerequisites
- WebView2 runtime

The frontend can also run by itself for layout development:

```powershell
npm run dev
```

## Verification

```powershell
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

## Publishing

CapSage updates are published as releases in the public
[`rmirabelle/capsage`](https://github.com/rmirabelle/capsage) repository. The app
uses GitHub's unauthenticated `releases/latest` API, so no access token or secret
is embedded in the executable.

1. Synchronize the version:

   ```powershell
   .\set-version.ps1 0.2.0
   ```

2. Review and commit the version changes.
3. Ensure GitHub CLI is authenticated with `gh auth login -h github.com`.
4. Publish from a clean working tree:

   ```powershell
   .\publish.ps1
   ```

The publish script validates all version declarations, builds the NSIS bundle,
pushes the release commit and annotated version tag, and creates a GitHub release
with a clean `CapSage_VERSION_x64-setup.exe` asset name. Published releases are
reduced to the new current release after publishing succeeds; superseded releases
and their tags are deleted because CapSage never rolls back through the updater.

## Project layout

```text
src/
  App.tsx                    Capture controller and global shortcut lifecycle
  components/
    Editor.tsx               Canvas editor and callout interactions
    DesktopRegionSelector.tsx  Full-desktop temporary region selector window
    TitleBar.tsx             Custom Windows title bar and Help menu
    AboutDialog.tsx          App identity and updater interface
    WindowControls.tsx       Native minimize/maximize/close controls
  editor/
    draw.ts                  Native-resolution annotation renderer
    geometry.ts              Callout and arrow geometry
    types.ts                 Capture/editor domain types
  index.css                  CapSage theme and application layout

src-tauri/
  src/capture.rs             Windows capture, PNG encoding, and file saving
  src/updater.rs             GitHub release check, download, and installer launch
  src/lib.rs                 Tauri plugins and command registration
  capabilities/default.json  Narrow frontend permissions
  tauri.conf.json            Window and NSIS bundle configuration
  icons/icon.ico             Multi-resolution Windows icon
```

## Technical notes

- The slate-tinted shell follows the other `{x}Sage` desktop applications while CapSage uses **#97f395** as its bright identity color.
- The process opts into per-monitor-v2 DPI awareness before Tauri creates a window, keeping Win32 capture bounds in physical pixels.
- Active-window capture currently tries `PrintWindow` first and falls back to desktop pixels when Windows rejects the request or returns a blank bitmap.
- Region selection uses the bounded selector window's physical screen coordinates and captures that rectangle only after the selector has been removed.
- Windows Graphics Capture is the intended hardening path for reliably capturing occluded or hardware-accelerated windows in a later milestone.

## Roadmap

- Windows Graphics Capture backend
- Additional annotation types and style controls
- Clipboard copy/paste
- Session recovery and editable CapSage project files
- Authenticode-signed installer releases

## License

Copyright © Robert Mirabelle. All rights reserved.
