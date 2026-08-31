import { ArrowRight, FloppyDisk, Lightning, Palette, SlidersHorizontal, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { CaptureStyle } from "../editor/style";

interface Props {
  style: CaptureStyle;
  isOriginal: boolean;
  canApply: boolean;
  onChange: (style: CaptureStyle) => void;
  onCancel: () => void;
  onReset: () => void;
  onApply: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onDelete: () => void;
}

const FONT_FAMILIES = [
  "Segoe UI",
  "Arial",
  "Calibri",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Courier New"
];

function ColorControl({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [hex, setHex] = useState(value.toUpperCase());

  useEffect(() => setHex(value.toUpperCase()), [value]);

  const normalizedHex = (input: string) => {
    const digits = input.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(digits)) return `#${digits.toLowerCase()}`;
    if (/^[0-9a-f]{3}$/i.test(digits)) {
      return `#${digits.split("").map((digit) => digit + digit).join("").toLowerCase()}`;
    }
    return null;
  };

  return (
    <label className="style-color-control">
      <span>{label}</span>
      <span className="style-color-value">
        <span className="style-color-picker-shell">
          <i className="style-color-picker-swatch" style={{ backgroundColor: value }} />
          <input
            className="style-color-picker"
            type="color"
            value={value}
            aria-label={`${label} color picker`}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
        <input
          className="style-hex-input"
          type="text"
          value={hex}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hex color`}
          onChange={(event) => {
            const next = event.target.value.toUpperCase();
            setHex(next);
            const digits = next.trim().replace(/^#/, "");
            if (/^[0-9A-F]{6}$/.test(digits)) onChange(`#${digits.toLowerCase()}`);
          }}
          onBlur={() => {
            const normalized = normalizedHex(hex);
            if (normalized) onChange(normalized);
            else setHex(value.toUpperCase());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}

export function StyleDialog({
  style,
  isOriginal,
  canApply,
  onChange,
  onCancel,
  onReset,
  onApply,
  onSave,
  onSaveAs,
  onDelete
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const initialStyleRef = useRef({ ...style });
  const hasChanges = JSON.stringify(style) !== JSON.stringify(initialStyleRef.current);
  const update = <Key extends keyof CaptureStyle>(key: Key, value: CaptureStyle[Key]) =>
    onChange({ ...style, [key]: value });

  return (
    <div className="confirm-overlay style-dialog-overlay" role="presentation" onPointerDown={onCancel}>
      <div
        className="style-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="style-dialog-header">
          <div className="style-dialog-icon"><Palette size={23} weight="duotone" /></div>
          <div>
            <h2 id="style-dialog-title">Edit Capture Style</h2>
            <p>Editing <strong>{style.name}</strong> · Preview changes here, then apply or save them.</p>
          </div>
        </header>

        <div className="style-dialog-body">
          <section className="style-controls">
            <div className="style-color-grid">
              <ColorControl
                label="Background & arrow"
                value={style.backgroundColor}
                onChange={(value) => update("backgroundColor", value)}
              />
              <ColorControl
                label="Border & focus"
                value={style.borderColor}
                onChange={(value) => update("borderColor", value)}
              />
              <ColorControl
                label="Text"
                value={style.textColor}
                onChange={(value) => update("textColor", value)}
              />
            </div>

            <label className="style-range-field">
              <span>Border thickness <strong>{style.borderThickness}px</strong></span>
              <input
                type="range"
                min="0"
                max="6"
                step="1"
                value={style.borderThickness}
                onChange={(event) => update("borderThickness", Number(event.target.value))}
              />
            </label>

            <label className="style-range-field">
              <span>Font size <strong>{style.fontSize}px</strong></span>
              <input
                type="range"
                min="12"
                max="72"
                step="1"
                value={style.fontSize}
                onChange={(event) => update("fontSize", Number(event.target.value))}
              />
            </label>

            <label className="style-range-field">
              <span>Callout scale <strong>{Math.round(style.calloutScale * 100)}%</strong></span>
              <input
                type="range"
                min="50"
                max="200"
                step="5"
                value={Math.round(style.calloutScale * 100)}
                onChange={(event) => update("calloutScale", Number(event.target.value) / 100)}
              />
            </label>

            <label className="style-field">
              <span>Font family</span>
              <select value={style.fontFamily} onChange={(event) => update("fontFamily", event.target.value)}>
                {FONT_FAMILIES.map((font) => <option key={font} value={font}>{font}</option>)}
              </select>
            </label>

            <label className="style-range-field">
              <span>Unfocused content opacity <strong>{Math.round(style.unfocusedOpacity * 100)}%</strong></span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(style.unfocusedOpacity * 100)}
                onChange={(event) => update("unfocusedOpacity", Number(event.target.value) / 100)}
              />
            </label>
          </section>

          <aside className="style-preview" aria-label="Style preview" style={{ backgroundColor: style.backgroundColor }}>
            <div className="style-preview-label"><SlidersHorizontal size={14} /> Live preview</div>
            <div
              className="style-preview-unfocused"
              style={{ opacity: style.unfocusedOpacity }}
            />
            <div
              className="style-preview-focus"
              style={{ borderColor: style.borderColor, borderWidth: style.borderThickness }}
            />
            <div
              className="style-preview-callout"
              style={{
                color: style.textColor,
                backgroundColor: style.backgroundColor,
                borderColor: style.borderColor,
                borderWidth: style.borderThickness * style.calloutScale,
                borderRadius: 18 * style.calloutScale,
                padding: `${17 * style.calloutScale}px ${22 * style.calloutScale}px`,
                fontFamily: style.fontFamily,
                fontSize: Math.min(34, Math.max(10, style.fontSize * style.calloutScale * 0.72))
              }}
            >
              Sage style
            </div>
            <div
              className="style-preview-arrow"
              style={{
                color: style.borderColor,
                backgroundColor: style.backgroundColor,
                transform: `scale(${style.calloutScale})`,
                transformOrigin: "left center"
              }}
            >
              <ArrowRight size={28} weight="fill" />
            </div>
          </aside>
        </div>

        <footer className="style-dialog-actions">
          {confirmingDelete ? (
            <>
              <span className="style-delete-prompt">Delete “{style.name}” permanently?</span>
              <button className="button secondary" onClick={() => setConfirmingDelete(false)}>Keep style</button>
              <button className="button danger" onClick={onDelete}><Trash size={15} /> Delete style</button>
            </>
          ) : (
            <>
              {isOriginal ? (
                <button className="style-reset-button" onClick={onReset}>Reset original recipe</button>
              ) : (
                <button className="style-delete-button" onClick={() => setConfirmingDelete(true)}>
                  <Trash size={14} /> Delete style
                </button>
              )}
              <span />
              <button className="button secondary" onClick={onCancel}>Cancel</button>
              <button
                className="button secondary"
                disabled={!canApply}
                title={canApply ? "Apply to the current capture" : "Take a capture to apply temporary style changes"}
                onClick={onApply}
              >
                <Lightning size={15} weight="fill" /> Apply
              </button>
              <button className="button secondary" onClick={onSaveAs}><FloppyDisk size={15} /> Save as…</button>
              {!isOriginal && (
                <button className="button primary" disabled={!hasChanges} onClick={onSave}>Save Changes</button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
