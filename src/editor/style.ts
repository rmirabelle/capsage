export interface CaptureStyle {
  id: string;
  name: string;
  backgroundColor: string;
  borderThickness: number;
  borderColor: string;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  calloutScale: number;
  unfocusedOpacity: number;
}

export const DEFAULT_CAPTURE_STYLE: CaptureStyle = {
  id: "sage-original-recipe",
  name: "Sage (original recipe)",
  backgroundColor: "#191d25",
  borderThickness: 3,
  borderColor: "#97f395",
  textColor: "#f4f4f5",
  fontSize: 26,
  fontFamily: "Segoe UI",
  calloutScale: 1,
  unfocusedOpacity: 0.42
};

export const CAPTURE_STYLES_KEY = "capsage.capture-styles";
export const ACTIVE_CAPTURE_STYLE_KEY = "capsage.active-capture-style";
export const CALLOUT_PADDING_X = 36;
export const CALLOUT_PADDING_Y = 24;
export const CALLOUT_LINE_HEIGHT = Math.ceil(DEFAULT_CAPTURE_STYLE.fontSize * 1.24);
export const MIN_CALLOUT_WIDTH = CALLOUT_PADDING_X * 2 + 40;
export const MIN_CALLOUT_HEIGHT = CALLOUT_PADDING_Y * 2 + CALLOUT_LINE_HEIGHT;
export const MAX_AUTO_CALLOUT_WIDTH = 720;
export const FOCUS_RADIUS = 18;
export const FOCUS_BLUR = 2;
export const MIN_FOCUS_SIZE = 56;

export function loadCaptureStyles(): CaptureStyle[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAPTURE_STYLES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [{ ...DEFAULT_CAPTURE_STYLE }];
    const saved = parsed
      .filter((style): style is Partial<CaptureStyle> & { id: string; name: string } =>
        Boolean(style && typeof style.id === "string" && typeof style.name === "string"))
      .map((style) => ({ ...DEFAULT_CAPTURE_STYLE, ...style }));
    const original = saved.find((style) => style.id === DEFAULT_CAPTURE_STYLE.id);
    const custom = saved.filter((style) => style.id !== DEFAULT_CAPTURE_STYLE.id);
    return [{ ...(original ?? DEFAULT_CAPTURE_STYLE) }, ...custom];
  } catch {
    return [{ ...DEFAULT_CAPTURE_STYLE }];
  }
}

export function loadActiveCaptureStyle(): CaptureStyle {
  const styles = loadCaptureStyles();
  const activeId = localStorage.getItem(ACTIVE_CAPTURE_STYLE_KEY) ?? DEFAULT_CAPTURE_STYLE.id;
  return { ...(styles.find((style) => style.id === activeId) ?? styles[0] ?? DEFAULT_CAPTURE_STYLE) };
}

export const calloutFontSize = (style: CaptureStyle) => style.fontSize * style.calloutScale;
export const calloutPaddingX = (style: CaptureStyle) => CALLOUT_PADDING_X * style.calloutScale;
export const calloutPaddingY = (style: CaptureStyle) => CALLOUT_PADDING_Y * style.calloutScale;
export const minCalloutWidth = (style: CaptureStyle) => MIN_CALLOUT_WIDTH * style.calloutScale;
export const minCalloutHeight = (style: CaptureStyle) => MIN_CALLOUT_HEIGHT * style.calloutScale;

export const captureStyleFont = (style: CaptureStyle) =>
  `400 ${calloutFontSize(style)}px "${style.fontFamily}", sans-serif`;

export const captureStyleLineHeight = (style: CaptureStyle) =>
  Math.ceil(calloutFontSize(style) * 1.24);
