import { CaretDown, Check, Palette, PencilSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  ACTIVE_CAPTURE_STYLE_KEY,
  DEFAULT_CAPTURE_STYLE,
  type CaptureStyle
} from "../editor/style";
import { StyleDialog } from "./StyleDialog";

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
  onChange,
  onEdit
}: {
  styles: CaptureStyle[];
  value: string;
  displayStyle: CaptureStyle;
  onChange: (id: string) => void;
  onEdit: (style: CaptureStyle) => void;
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
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <StyleSwatches style={displayStyle} />
        <span className="capture-style-name">{selected?.name ?? "Capture style"}</span>
        <CaretDown size={13} weight="bold" />
      </button>
      {open && (
        <div className="capture-style-select-menu" role="menu" aria-label="Capture styles">
          {styles.map((style) => {
            const isSelected = style.id === value;
            return (
              <div
                key={style.id}
                className={`capture-style-option ${isSelected ? "selected" : ""}`}
              >
                <button
                  type="button"
                  className="capture-style-option-select"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => {
                    onChange(style.id);
                    setOpen(false);
                  }}
                >
                  <StyleSwatches style={style} />
                  <span className="capture-style-name">{style.name}</span>
                  {isSelected && <Check size={14} weight="bold" />}
                </button>
                <button
                  type="button"
                  className="capture-style-option-edit"
                  aria-label={`Edit ${style.name}`}
                  title={`Edit ${style.name}`}
                  onClick={() => {
                    onEdit(style);
                    setOpen(false);
                  }}
                >
                  <PencilSimple size={14} />
                </button>
              </div>
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
  initialStyle: CaptureStyle;
  styles: CaptureStyle[];
  onCreateStyle: (style: CaptureStyle) => void;
  onDeleteStyle: (id: string) => void;
  onSaveStyle: (style: CaptureStyle) => void;
  onStyleChange: (style: CaptureStyle) => void;
}

export function CaptureStyleToolbar({
  initialStyle,
  styles,
  onCreateStyle,
  onDeleteStyle,
  onSaveStyle,
  onStyleChange
}: Props) {
  const [styleDraft, setStyleDraft] = useState<CaptureStyle | null>(null);
  const [pendingNewStyle, setPendingNewStyle] = useState<CaptureStyle | null>(null);
  const [suggestedStyleName, setSuggestedStyleName] = useState("");
  const savedStyle = styles.find((style) => style.id === initialStyle.id);
  const hasCaptureOverride = !savedStyle
    || JSON.stringify(savedStyle) !== JSON.stringify(initialStyle);
  const captureStyle = hasCaptureOverride ? initialStyle : savedStyle;

  const selectStyle = (id: string) => {
    const selected = styles.find((style) => style.id === id);
    if (!selected) return;
    localStorage.setItem(ACTIVE_CAPTURE_STYLE_KEY, id);
    onStyleChange({ ...selected });
  };

  const saveStyleChanges = () => {
    if (!styleDraft) return;
    const saved = { ...styleDraft };
    onSaveStyle(saved);
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
    onCreateStyle(saved);
    localStorage.setItem(ACTIVE_CAPTURE_STYLE_KEY, saved.id);
    onStyleChange(saved);
    setPendingNewStyle(null);
    return null;
  };

  const deleteStyle = () => {
    if (!styleDraft || styleDraft.id === DEFAULT_CAPTURE_STYLE.id) return;
    if (localStorage.getItem(ACTIVE_CAPTURE_STYLE_KEY) === styleDraft.id) {
      localStorage.setItem(ACTIVE_CAPTURE_STYLE_KEY, DEFAULT_CAPTURE_STYLE.id);
    }
    onDeleteStyle(styleDraft.id);
    setStyleDraft(null);
  };

  return (
    <>
      <div className="style-toolbar">
        <span className="style-toolbar-label"><Palette size={15} weight="duotone" /> Style</span>
        <CaptureStyleDropdown
          styles={styles}
          value={initialStyle.id}
          displayStyle={captureStyle}
          onChange={selectStyle}
          onEdit={(style) => setStyleDraft({ ...style })}
        />
        {hasCaptureOverride && <span className="capture-style-override">Capture only</span>}
      </div>
      {styleDraft && (
        <StyleDialog
          style={styleDraft}
          isOriginal={styleDraft.id === DEFAULT_CAPTURE_STYLE.id}
          onChange={setStyleDraft}
          onCancel={() => setStyleDraft(null)}
          onReset={() => setStyleDraft({ ...DEFAULT_CAPTURE_STYLE })}
          onSave={saveStyleChanges}
          onSaveAs={requestSaveStyleAsNew}
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
