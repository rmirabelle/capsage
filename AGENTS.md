# CapSage repository instructions

## Release memory

- Read `docs/RELEASING.md` before changing installer configuration, preparing a
  release, or publishing.
- Preserve the shared XSage per-user installer contract. Do not switch to
  `perMachine` or Program Files unless the user explicitly reopens that product
  decision.
- Keep `src-tauri/installer.nsi`, the bundled `icons/icon.ico` resource, and the
  Windows GUI-subsystem attribute intact.
- Always build and manually verify the local installer before publishing. A local
  build is not authorization to publish.
- Use `set-version.ps1` and `publish.ps1`; do not manually create release tags or
  GitHub releases.
- The publish workflow intentionally deletes superseded releases only after the
  new release and its installer asset pass verification.

## Development process

- Restart the dev app after runtime edits when needed for user testing.
- Do not start the dev app when an installed CapSage tray build is active unless
  the user specifically wants both; stop the conflicting instance first.
- In managed Codex sessions, prefer process-local Git `safe.directory` variables
  documented in `docs/RELEASING.md`; never alter the user's global Git config.
