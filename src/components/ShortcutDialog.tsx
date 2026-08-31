import { Keyboard, Warning } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  currentShortcut: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (shortcut: string) => void;
}

const KEY_NAMES: Record<string, string> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Control: "Ctrl",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Equal: "=",
  Home: "Home",
  Insert: "Insert",
  Meta: "Win",
  Minus: "-",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Period: ".",
  PrintScreen: "Print Screen",
  Quote: "'",
  Semicolon: ";",
  Shift: "Shift",
  Slash: "/",
  Space: "Space",
  Tab: "Tab"
};

const SUPPORTED_CODES = new Set([
  "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Backquote", "Backslash",
  "BracketLeft", "BracketRight", "Comma", "Delete", "End", "Enter", "Equal",
  "Home", "Insert", "Minus", "PageDown", "PageUp", "Period", "PrintScreen",
  "Quote", "Semicolon", "Slash", "Space", "Tab"
]);

export function shortcutTokens(shortcut: string) {
  return shortcut.split("+").filter(Boolean).map((token) => KEY_NAMES[token] ?? token);
}

export function formatShortcut(shortcut: string) {
  return shortcutTokens(shortcut).join(" + ");
}

function primaryKey(event: KeyboardEvent) {
  const code = event.code || event.key;
  if (event.key === "PrintScreen") return "PrintScreen";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (SUPPORTED_CODES.has(code)) return code;
  return null;
}

function modifiersFor(event: KeyboardEvent, held: Set<string>) {
  const modifiers: string[] = [];
  if (event.ctrlKey || held.has("Ctrl")) modifiers.push("Ctrl");
  if (event.altKey || held.has("Alt")) modifiers.push("Alt");
  if (event.shiftKey || held.has("Shift")) modifiers.push("Shift");
  if (event.metaKey || held.has("Meta")) modifiers.push("Meta");
  return modifiers;
}

function modifierKey(event: KeyboardEvent) {
  if (event.key === "Control") return "Ctrl";
  if (event.key === "Alt") return "Alt";
  if (event.key === "Shift") return "Shift";
  if (event.key === "Meta") return "Meta";
  return null;
}

function Keycaps({ shortcut }: { shortcut: string }) {
  const tokens = shortcutTokens(shortcut);
  return (
    <span className="shortcut-keycaps" aria-label={formatShortcut(shortcut)}>
      {tokens.map((token, index) => (
        <span className="shortcut-key-part" key={`${token}-${index}`}>
          {index > 0 && <i>+</i>}
          <kbd>{token}</kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutDialog({ currentShortcut, busy, error, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState(currentShortcut);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [listening, setListening] = useState(true);
  const heldModifiers = useRef(new Set<string>());
  const windowsConflict = draft === "Alt+PrintScreen";
  const displayError = error ?? recordingError;
  const changed = draft !== currentShortcut;

  useEffect(() => {
    const record = (event: KeyboardEvent) => {
      if (busy) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        onCancel();
        return;
      }

      const modifier = modifierKey(event);
      if (modifier) {
        heldModifiers.current.add(modifier);
        setListening(true);
        return;
      }

      const key = primaryKey(event);
      const modifiers = modifiersFor(event, heldModifiers.current);
      if (!key) {
        setRecordingError("That key is not supported. Try a letter, number, function key, or Print Screen.");
        return;
      }
      if (modifiers.length === 0) {
        setRecordingError("Include Ctrl, Alt, Shift, or the Windows key.");
        return;
      }

      setDraft([...modifiers, key].join("+"));
      setRecordingError(null);
      setListening(false);
    };

    const onKeyDown = (event: KeyboardEvent) => record(event);
    const onKeyUp = (event: KeyboardEvent) => {
      if (primaryKey(event) === "PrintScreen") record(event);
      const modifier = modifierKey(event);
      if (modifier) heldModifiers.current.delete(modifier);
    };
    const clearHeldModifiers = () => heldModifiers.current.clear();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", clearHeldModifiers);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", clearHeldModifiers);
    };
  }, [busy, onCancel]);

  const instruction = useMemo(
    () => listening ? "Press the complete key combination now" : "Shortcut recorded",
    [listening]
  );

  return (
    <div className="confirm-overlay shortcut-dialog-overlay" role="presentation" onPointerDown={onCancel}>
      <section
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="shortcut-dialog-icon"><Keyboard size={24} weight="duotone" /></span>
          <div>
            <h2 id="shortcut-dialog-title">Capture Shortcut</h2>
            <p>Choose the global shortcut that starts a capture from any app.</p>
          </div>
        </header>

        <div className={`shortcut-recorder ${listening ? "listening" : ""}`}>
          <span className="shortcut-recorder-label">{instruction}</span>
          <Keycaps shortcut={draft} />
          <button type="button" onClick={() => setListening(true)}>Record another</button>
        </div>

        {windowsConflict && (
          <div className="shortcut-dialog-warning">
            <Warning size={18} weight="fill" />
            <span><strong>Alt + Print Screen belongs to Windows.</strong> It copies the active window to the clipboard. CapSage may replace that behavior while it is running.</span>
          </div>
        )}

        {displayError && <p className="shortcut-dialog-error" role="alert">{displayError}</p>}

        <footer>
          <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="button primary" type="button" disabled={busy || !changed || Boolean(recordingError)} onClick={() => onSave(draft)}>
            {busy ? "Saving…" : "Save Shortcut"}
          </button>
        </footer>
      </section>
    </div>
  );
}
