# CapSage release playbook

This is the durable source of truth for building, testing, and publishing CapSage.
Do not publish directly from memory or bypass `publish.ps1`.

## Windows installer contract

CapSage follows the shared XSage installer protocol used by DB Sage and the other
XSage desktop applications:

- Installation is **per-user** (`currentUser`), under the user's local application
  data. Do not change it to `perMachine` or Program Files without an explicit new
  product decision and a full installer migration plan.
- `src-tauri/installer.nsi` is the shared custom XSage NSIS template.
- `src-tauri/icons/icon.ico` must be both the bundle icon and a bundled resource.
- The installer copies the icon to
  `C:\Users\Public\${PRODUCTNAME}\icon.ico`, then assigns that explicit path and
  the AppUserModelId to Start Menu and optional desktop shortcuts. Explorer does
  not reliably expand an environment-variable icon path in shortcut metadata.
- Release builds use the Windows GUI PE subsystem. The release executable must
  never open a console window.
- First installation does not offer an uninstall choice. A same-version manual
  rerun offers repair/reinstall or uninstall; a newer manual installer offers the
  upgrade flow. Windows Settings also contains the normal uninstall entry.
- CapSage is a tray application: closing its main window does not stop
  `capsage.exe`. Manual install, repair, upgrade, and uninstall automatically
  stop the per-user process before changing files. Do not restore Tauri's stock
  interactive kill-confirmation macro; its nested prompt can appear behind setup
  and make a waiting uninstall look failed. In-app updates already exit CapSage
  gracefully before launching setup.

`publish.ps1` validates these rules before it creates a tag and validates the
generated executable and NSIS script again after the release build.

## Release workflow

1. Stop the Tauri dev process. Avoid running the dev and installed tray builds at
   the same time because their tray icons, shortcuts, and window behavior are easy
   to confuse.
2. Synchronize the intended semantic version:

   ```powershell
   .\set-version.ps1 0.2.0
   ```

3. Review the version changes, build the installer locally, and resolve every
   warning or error:

   ```powershell
   npm run tauri build
   ```

4. Install that exact local NSIS bundle from
   `src-tauri\target\release\bundle\nsis` and manually verify:

   - no console window appears;
   - CapSage starts tray-only;
   - the tray icon restores and exits the app correctly;
   - Start Menu and optional desktop shortcuts show the CapSage icon;
   - with CapSage running in the tray, repair/upgrade closes it automatically
     without an additional confirmation and completes the uninstall stage;
   - the fresh install, same-version repair, upgrade, and uninstall paths all
     behave as expected.

5. Commit and push the reviewed source changes. Publishing requires a clean work
   tree and the public `rmirabelle/capsage` origin.
6. Confirm GitHub CLI authentication, then publish:

   ```powershell
   gh auth status
   .\publish.ps1
   ```

7. Confirm the printed release URL and test the app's update check if the release
   is intended to update an older installed version.

Do not run `publish.ps1` until the local installer has passed the manual check.
The script creates and verifies the new public release first, then deletes every
older release and its tag. If verification fails before cleanup, older releases
are intentionally preserved.

## Codex workspace note

If Git reports dubious ownership only inside the managed Codex environment, use a
process-local safe-directory override rather than changing the user's global Git
configuration:

```powershell
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = 'D:/Code/CapSage'
.\publish.ps1
```

This override is an automation-environment workaround, not part of normal CapSage
installation or publishing.
