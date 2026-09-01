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
- Per-user Windows installation following the shared XSage installer protocol

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

## Codex on Windows troubleshooting

Read this section before changing Codex sandbox settings, repository ACLs, or
Tauri/Vite ports. It records the working state established after the Windows
sandbox incident on 2026-09-01.

### Known-good development layout

CapSage and DBSage deliberately use separate, fixed ports. `strictPort: true`
is intentional: a port collision should fail clearly instead of silently
connecting a Tauri window to the wrong frontend.

| Application | Vite dev | HMR | Preview |
| --- | ---: | ---: | ---: |
| DBSage | 14210 | 14211 | 14212 |
| CapSage | 14310 | 14311 | 14312 |

For CapSage, `vite.config.ts` and `src-tauri/tauri.conf.json` must agree on port
14310. Do not change only `build.devUrl`. Before starting `npm run tauri dev`,
also confirm that an installed CapSage tray process is not already active:

```powershell
Get-Process -Name capsage -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 14310 -ErrorAction SilentlyContinue
```

Stop a conflicting installed or stale development process deliberately. Do not
kill every Node, Cargo, or Tauri process on the machine; DBSage may be running at
the same time on its own ports.

### The two sandbox failures are different

#### 1. Sandbox setup or ACL failure

Typical signs include a sandbox setup/refresh error, `Access denied` while
Codex applies a deny ACE, Git becoming unreadable, or repository metadata owned
by a `CodexSandbox...` account instead of the normal Windows user.

Inspect first; do not immediately restart or recursively rewrite permissions:

```powershell
Get-Acl . | Select-Object Owner
Get-Acl .git | Select-Object Owner
if (Test-Path .codex) { Get-Acl .codex | Select-Object Owner }

$codexHome = if ($env:CODEX_HOME) {
  $env:CODEX_HOME
} else {
  Join-Path $env:USERPROFILE ".codex"
}
$sandboxLog = Get-ChildItem "$codexHome\.sandbox\sandbox*.log" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$sandboxLog | Select-Object FullName, LastWriteTime
Get-Content -LiteralPath $sandboxLog.FullName -Tail 200
```

During the 2026-09-01 incident, the log identified two repository metadata
paths affected by prior elevated-sandbox setup: `.git` and an empty `.codex`
directory. `.git` ownership was restored to the normal Windows user, and the
verified-empty stale `.codex` directory was removed. Do not copy those repairs
blindly: use the log to identify the exact failing path, verify its contents,
and never delete a non-empty `.codex` directory just because it exists.

On managed Codex sessions, do not modify the user's global Git configuration to
work around ownership checks. Use a process-local override when one is needed:

```powershell
git -c safe.directory=D:/Code/CapSage status
```

#### 2. Nested Node child-process `EPERM`

This is the failure that affected Vite/esbuild. Normal shell commands, Git, and
Rust could work while `npm run build` failed at esbuild's
`ensureServiceIsRunning` with `Error: spawn EPERM`. Directly running Node or the
esbuild executable does not disprove this failure: the denied operation is Node
creating another process from inside the unelevated sandbox.

Use this small probe to distinguish it from a broken Vite configuration:

```powershell
node -e "const {spawnSync}=require('node:child_process'); const r=spawnSync(process.execPath,['--version'],{encoding:'utf8'}); console.log(r.error?.code ?? r.status)"
```

If that prints `EPERM`, do not keep changing Vite, Tauri, ports, or
`windowsHide`, and do not repeatedly restart Codex. Use a persistent,
command-scoped Codex approval/rule for only the workflows that require nested
process creation:

```text
npm run build
npm run tauri dev
npm run tauri build
```

When Codex requests permission, approve only the exact command prefix and use
the option to remember that narrow rule. The confirmed working result for this
incident was a successful frontend build under the `npm run build` exception,
a successful `cargo check` in the normal sandbox, and a successful Tauri dev
launch under the `npm run tauri dev` exception.

Keep normal inspection, editing, Git, TypeScript-only checks, and Rust checks in
the sandbox. Avoid full-access mode or a broad approval for all `node`, `npm`,
PowerShell, or shell commands.

### Codex sandbox configuration

OpenAI documents `elevated` as the preferred native Windows sandbox and
`unelevated` as the fallback when administrator-approved setup is blocked. This
machine's working fallback during the incident was:

```toml
[windows]
sandbox = "unelevated"
```

Both modes use a private desktop by default. Setting
`sandbox_private_desktop = false` is a UI-compatibility option; it did **not**
fix the Node/esbuild `spawn EPERM` failure and should not be treated as the
solution for it.

Changing the global Codex configuration is one of the few cases where a single
Codex restart may be required. A deterministic `spawn EPERM` that returns after
every restart is not. Stop restarting, run the Node probe, and use the narrow
command exception described above.

For unresolved setup failures, retain the sandbox log and record the Windows
version, selected sandbox mode, exact error, failing command, and affected path.
Never share the contents of `CODEX_HOME/.sandbox-secrets/`. See the official
[OpenAI Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox)
for the current mode definitions and diagnostic guidance.

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
is embedded in the executable. Read the complete
[release playbook](docs/RELEASING.md) before preparing or publishing a release.

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

The publish script validates all version declarations and XSage installer
invariants, builds the NSIS bundle, pushes the release commit and annotated
version tag, and creates a GitHub release with a clean
`CapSage_VERSION_x64-setup.exe` asset name. Published releases are reduced to the
new current release only after the new release and updater endpoint are verified;
superseded releases and their tags are deleted because CapSage never rolls back
through the updater.

### Installer handling of a running CapSage instance

CapSage remains active in the notification area when its main window is closed.
During manual install, repair, upgrade, or uninstall, setup automatically stops
that per-user process before replacing or removing files. It does not display
Tauri's additional "Click OK to kill it" confirmation; failure to terminate the
process is still reported and aborts the operation safely. In-app updates use
CapSage's graceful exit path before launching setup.

Older installers may leave the running-app prompt behind another setup window,
making uninstall appear stuck. That condition is not a Codex sandbox request,
repository ACL problem, or Tauri dev-server collision. Future changes to
`src-tauri/installer.nsi` must preserve the automatic process stop;
`publish.ps1` enforces it.

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
