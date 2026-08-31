import { CaretDown, Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  ACTIVE_CAPTURE_STYLE_KEY,
  CAPTURE_STYLES_KEY,
  DEFAULT_CAPTURE_STYLE,
  type CaptureStyle
} from "../editor/style";
import { StyleDialog } from "./StyleDialog";

function loadCaptureStyles(): CaptureStyle[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAPTURE_STYLES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [{ ...DEFAULT_CAPTURE_STYLE }];
    const saved = parsed
      .filter((style): style is Partial<CaptureStyle> & { id: string; name: string } =>
        Boolean(style && typeof style.id === "string" && typeof style.name === "string"))
      .map((style) => ({ ...DEFAULT_CAPTURE_STYLE, ...style }));
    const custom = saved.filter((style) => style.id !== DEFAULT_CAPTURE_STYLE.id);
    return [{ ...DEFAULT_CAPTURE_STYLE }, ...custom];
  } catch {
    return [{ ...DEFAULT_CAPTURE_STYLE }];
  }
}

function StyleSwatches({ style }: { style: CaptureStyle }) {
  return (
    <span className="capture-style-swatches" aria-hidden="true">
      <i style={{ background: style.backgroundColor }} />
      <i style={{ background: style.borderColor }} />
      <i style={{ background: style.textColor }} />
    </span>
  );
}

function CaptureStyleDropdown({
  styles,
  value,
  displayStyle,
  onChange
}: {
  styles: CaptureStyle[];
  value: string;
  displayStyle: CaptureStyle;
  onChange: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = styles.find((style) => style.id === value) ?? styles[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`capture-style-select ${open ? "open" : ""}`}>
      <button
        type="button"
        className="capture-style-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <StyleSwatches style={displayStyle} />
        <span className="capture-style-name">{selected?.name ?? "Capture style"}</span>
        <CaretDown size={13} weight="bold" />
      </button>
      {open && (
        <div className="capture-style-select-menu" role="listbox" aria-label="Capture style">
          {styles.map((style) => {
            const isSelected = style.id === value;
            return (
              <button
                type="button"
                key={style.id}
                className={isSelected ? "selected" : ""}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(style.id);
                  setOpen(false);
                }}
              >
                <StyleSwatches style={style} />
                <span className="capture-style-name">{style.name}</span>
                {isSelected && <Check size={14} weight="bold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StyleNameDialog({
  sourceStyle,
  initialName,
  onCancel,
  onCreate
}: {
  sourceStyle: CaptureStyle;
  initialName: string;
  onCancel: () => void;
  onCreate: (name: string) => string | null;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const nextName = name.trim();
    if (!nextName) {
      setError("Enter a name for the new style.");
      return;
    }
    setError(onCreate(nextName));
  };

  return (
    <div className="confirm-overlay" role="presentation" onPointerDown={onCancel}>
      <form
        className="style-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-name-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <StyleSwatches style={sourceStyle} />
          <div>
            <h2 id="style-name-dialog-title">Name new style</h2>
            <p>Save these visual settings as a reusable preset.</p>
          </div>
        </header>
        <label>
          <span>Style name</span>
          <input
            autoFocus
            type="text"
            value={name}
            placeholder="My capture style"
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </label>
        {error && <p className="style-name-error">{error}</p>}
        <footer>
          <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="button primary">Create style</button>
        </footer>
      </form>
    </div>
  );
}

interface Props {
  hasCapture: boolean;
  captureSession: number;
  onStyleChange: (style: CaptureStyle) => void;
}

export function CaptureStyleToolbar({ hasCapture, captureSession, onStyleChange }: Props) {
  const [styles, setStyles] = useState<CaptureStyle[]>(loadCaptureStyles);
  const [activeStyleId, setActiveStyleId] = useState(() =>
    localStorage.getItem(ACTIVE_CAPTURE_STYLE_KEY) ?? DEFAULT_CAPTURE_STYLE.id
  );
  const [appliedStyle, setAppliedStyle] = useState<CaptureStyle | null>(null);
  const [styleDraft, setStyleDraft] = useState<CaptureStyle | null>(null);
  const [pendingNewStyle, setPendingNewStyle] = useState<CaptureStyle | null>(null);
  const [suggestedStyleName, setSuggestedStyleName] = useState("");
  const activeStyle = styles.find((style) => style.id === activeStyleId) ?? styles[0] ?? DEFAULT_CAPTURE_STYLE;
  const captureStyle = appliedStyle ?? activeStyle;

  useEffect(() => onStyleChange(captureStyle), [captureStyle, onStyleChange]);
  useEffect(() => setAppliedStyle(null), [captureSession]);
  useEffect(() => {
    if (!hasCapture) setAppliedStyle(null);
  }, [hasCapture]);

  const persistStyles = (next: CaptureStyle[]) => {
    setStyles(next);
    localStorage.setItem(CAPTURE_STYLES_KEY, JSON.stringify(next));
  };

  const selectStyle = (id: string) => {
    setAppliedStyle(null);
    setActiveStyleId(id);
    localStorage.setItem(ACTIVE_CAPTURE_STYLE_KEY, id);
  };

  const saveStyleChanges = () => {
    if (!styleDraft) return;
    const saved = { ...styleDraft };
    persistStyles(styles.map((style) => style.id === saved.id ? saved : style));
    selectStyle(saved.id);
    setStyleDraft(null);
  };

  const requestSaveStyleAsNew = () => {
    if (!styleDraft) return;
    setPendingNewStyle({ ...styleDraft });
    setSuggestedStyleName(styleDraft.id === DEFAULT_CAPTURE_STYLE.id ? "" : `${styleDraft.name} copy`);
    setStyleDraft(null);
  };

  const createNamedStyle = (name: string) => {
    if (!pendingNewStyle) return "The source style is no longer available.";
    if (styles.some((style) => style.name.toLowerCase() === name.toLowerCase())) {
      return "A style with this name already exists.";
    }
    const saved = { ...pendingNewStyle, id: crypto.randomUUID(), name };
    persistStyles([...styles, saved]);
    selectStyle(saved.id);
    setPendingNewStyle(null);
    return null;
  };

  const deleteStyle = () => {
    if (!styleDraft || styleDraft.id === DEFAULT_CAPTURE_STYLE.id) return;
    persistStyles(styles.filter((style) => style.id !== styleDraft.id));
    selectStyle(DEFAULT_CAPTURE_STYLE.id);
    setStyleDraft(null);
  };

  const applyStyleToCapture = () => {
    if (!styleDraft || !hasCapture) return;
    setAppliedStyle({ ...styleDraft });
    setStyleDraft(null);
  };

  return (
    <>
      <div className="style-toolbar">
        <span className="style-toolbar-label">Capture style</span>
        <CaptureStyleDropdown
          styles={styles}
          value={activeStyle.id}
          displayStyle={captureStyle}
          onChange={selectStyle}
        />
        <button className="edit-style-button" onClick={() => setStyleDraft({ ...captureStyle })}>Edit Style</button>
        {appliedStyle && <span className="capture-style-override">Capture only</span>}
      </div>
      {styleDraft && (
        <StyleDialog
          style={styleDraft}
          isOriginal={styleDraft.id === DEFAULT_CAPTURE_STYLE.id}
          canApply={hasCapture}
          onChange={setStyleDraft}
          onCancel={() => setStyleDraft(null)}
          onReset={() => setStyleDraft({ ...DEFAULT_CAPTURE_STYLE })}
          onSave={saveStyleChanges}
          onSaveAs={requestSaveStyleAsNew}
          onApply={applyStyleToCapture}
          onDelete={deleteStyle}
        />
      )}
      {pendingNewStyle && (
        <StyleNameDialog
          sourceStyle={pendingNewStyle}
          initialName={suggestedStyleName}
          onCancel={() => {
            setStyleDraft({ ...pendingNewStyle });
            setPendingNewStyle(null);
          }}
          onCreate={createNamedStyle}
        />
      )}
    </>
  );
}
