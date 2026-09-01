import { FloppyDisk, Lightning, Palette, SlidersHorizontal, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { drawCallout, measureCalloutForText } from "../editor/draw";
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

type RgbColor = { r: number; g: number; b: number };
type HsvColor = { h: number; s: number; v: number };
type ColorStyleKey = "backgroundColor" | "borderColor" | "textColor";

const COLOR_LABELS: Record<ColorStyleKey, string> = {
  backgroundColor: "Background & arrow",
  borderColor: "Border & focus",
  textColor: "Text"
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const normalizedHex = (input: string) => {
  const digits = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(digits)) return `#${digits.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(digits)) {
    return `#${digits.split("").map((digit) => digit + digit).join("").toLowerCase()}`;
  }
  return null;
};

const hexToRgb = (hex: string): RgbColor => {
  const normalized = normalizedHex(hex) ?? "#000000";
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  };
};

const rgbToHex = ({ r, g, b }: RgbColor) => `#${[r, g, b]
  .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
  .join("")}`;

const rgbToHsv = ({ r, g, b }: RgbColor): HsvColor => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    h: (hue + 360) % 360,
    s: maximum === 0 ? 0 : delta / maximum,
    v: maximum
  };
};

const hsvToRgb = ({ h, s, v }: HsvColor): RgbColor => {
  const chroma = v * s;
  const segment = ((h % 360) + 360) % 360 / 60;
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
  const offset = v - chroma;
  const [red, green, blue] = segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
      : segment < 3 ? [0, chroma, secondary]
        : segment < 4 ? [0, secondary, chroma]
          : segment < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  return {
    r: Math.round((red + offset) * 255),
    g: Math.round((green + offset) * 255),
    b: Math.round((blue + offset) * 255)
  };
};

function ColorControl({
  label,
  value,
  active,
  onOpen
}: {
  label: string;
  value: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="style-color-control">
      <span>{label}</span>
      <button
        type="button"
        className={`style-color-swatch-button ${active ? "active" : ""}`}
        style={{ backgroundColor: value }}
        aria-label={`Edit ${label.toLowerCase()} color`}
        aria-pressed={active}
        aria-controls="themed-color-picker"
        onClick={onOpen}
      />
    </div>
  );
}

function ThemedColorPicker({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const rgb = hexToRgb(value);
  const hsv = rgbToHsv(rgb);
  const [rgbDraft, setRgbDraft] = useState({ r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) });
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());

  useEffect(() => {
    const next = hexToRgb(value);
    setRgbDraft({ r: String(next.r), g: String(next.g), b: String(next.b) });
    setHexDraft(value.toUpperCase());
  }, [value]);

  const updateFromWheel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) / 2;
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const saturation = clamp(Math.hypot(x, y) / radius, 0, 1);
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    onChange(rgbToHex(hsvToRgb({ h: hue, s: saturation, v: hsv.v })));
  };

  const changeRgb = (channel: keyof RgbColor, next: string) => {
    setRgbDraft((current) => ({ ...current, [channel]: next }));
    if (!/^\d{1,3}$/.test(next)) return;
    const numeric = Number(next);
    if (numeric > 255) return;
    onChange(rgbToHex({ ...rgb, [channel]: numeric }));
  };

  const resetRgbDraft = () => {
    const current = hexToRgb(value);
    setRgbDraft({ r: String(current.r), g: String(current.g), b: String(current.b) });
  };

  const wheelAngle = hsv.h * Math.PI / 180;
  const fullValueColor = rgbToHex(hsvToRgb({ ...hsv, v: 1 }));

  return (
    <section
      id="themed-color-picker"
      className={`themed-color-picker ${disabled ? "disabled" : ""}`}
      aria-label={`${label} color picker`}
      aria-disabled={disabled}
    >
      <div
        className="themed-color-wheel"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={`${label} hue and saturation`}
        aria-valuetext={`Hue ${Math.round(hsv.h)} degrees, saturation ${Math.round(hsv.s * 100)} percent`}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromWheel(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromWheel(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const next = { ...hsv };
          if (event.key === "ArrowLeft") next.h = (next.h + 358) % 360;
          else if (event.key === "ArrowRight") next.h = (next.h + 2) % 360;
          else if (event.key === "ArrowUp") next.s = clamp(next.s + 0.02, 0, 1);
          else if (event.key === "ArrowDown") next.s = clamp(next.s - 0.02, 0, 1);
          else return;
          event.preventDefault();
          onChange(rgbToHex(hsvToRgb(next)));
        }}
      >
        <i className="themed-color-wheel-shade" style={{ opacity: 1 - hsv.v }} />
        <i
          className="themed-color-wheel-thumb"
          style={{
            left: `${50 + Math.cos(wheelAngle) * hsv.s * 50}%`,
            top: `${50 + Math.sin(wheelAngle) * hsv.s * 50}%`,
            backgroundColor: value
          }}
        />
      </div>
      <div className="themed-color-picker-values">
        <label className="themed-color-brightness">
          <span>Brightness <strong>{Math.round(hsv.v * 100)}%</strong></span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(hsv.v * 100)}
            disabled={disabled}
            style={{ background: `linear-gradient(90deg, #000000, ${fullValueColor})` }}
            onChange={(event) => onChange(rgbToHex(hsvToRgb({ ...hsv, v: Number(event.target.value) / 100 })))}
          />
        </label>
        <div className="themed-color-rgb-fields">
          {(["r", "g", "b"] as const).map((channel) => (
            <label key={channel}>
              <span>{channel.toUpperCase()}</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={3}
                value={rgbDraft[channel]}
                disabled={disabled}
                onChange={(event) => changeRgb(channel, event.target.value)}
                onBlur={resetRgbDraft}
              />
            </label>
          ))}
        </div>
        <label className="themed-color-hex-field">
          <span>Hex</span>
          <input
            type="text"
            aria-label="Hex color"
            maxLength={7}
            spellCheck={false}
            value={hexDraft}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setHexDraft(next);
              const digits = next.trim().replace(/^#/, "");
              if (/^[0-9A-F]{6}$/.test(digits)) onChange(`#${digits.toLowerCase()}`);
            }}
            onBlur={() => {
              const normalized = normalizedHex(hexDraft);
              if (normalized) onChange(normalized);
              else setHexDraft(value.toUpperCase());
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </div>
    </section>
  );
}

function CalloutPreview({ style }: { style: CaptureStyle }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const text = "Sage style";
    const bounds = measureCalloutForText(context, text, canvas.width - 50, style);
    const x = 22;
    const y = 65;
    drawCallout(context, {
      id: "style-preview-callout",
      x,
      y,
      width: bounds.width,
      height: bounds.height,
      text,
      targetX: Math.min(canvas.width - 28, x + bounds.width + 55 * style.calloutScale),
      targetY: Math.min(canvas.height - 36, y + bounds.height + 105 * style.calloutScale)
    }, style);
  }, [style]);

  return <canvas ref={canvasRef} className="style-preview-callout-canvas" width={440} height={520} />;
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
  const [openColor, setOpenColor] = useState<ColorStyleKey | null>(null);
  const initialStyleRef = useRef({ ...style });
  const hasChanges = JSON.stringify(style) !== JSON.stringify(initialStyleRef.current);
  const update = <Key extends keyof CaptureStyle>(key: Key, value: CaptureStyle[Key]) =>
    onChange({ ...style, [key]: value });
  const updateColor = (key: ColorStyleKey, value: string) =>
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
            <h2 id="style-dialog-title">Edit Style</h2>
            <p>Editing <strong>{style.name}</strong> · Preview changes here, then apply or save them.</p>
          </div>
        </header>

        <div className="style-dialog-body">
          <section className="style-controls">
            <div className="style-color-grid">
              <ColorControl
                label="Background & arrow"
                value={style.backgroundColor}
                active={openColor === "backgroundColor"}
                onOpen={() => setOpenColor("backgroundColor")}
              />
              <ColorControl
                label="Border & focus"
                value={style.borderColor}
                active={openColor === "borderColor"}
                onOpen={() => setOpenColor("borderColor")}
              />
              <ColorControl
                label="Text"
                value={style.textColor}
                active={openColor === "textColor"}
                onOpen={() => setOpenColor("textColor")}
              />
              <ThemedColorPicker
                label={openColor ? COLOR_LABELS[openColor] : "Style"}
                value={openColor ? style[openColor] : "#808080"}
                disabled={!openColor}
                onChange={(value) => {
                  if (openColor) updateColor(openColor, value);
                }}
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
            <CalloutPreview style={style} />
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
