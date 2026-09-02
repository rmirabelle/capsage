import type { CaptureStyle } from "./style";
import type { Callout, CaptureResult, CropRegion, FocusRegion } from "./types";

export const CAPSAGE_DOCUMENT_FORMAT = "capsage-document";
export const CAPSAGE_DOCUMENT_VERSION = 2;

export interface EditorDocumentState {
  callouts: Callout[];
  focuses: FocusRegion[];
  crop: CropRegion | null;
}

export interface CapSageDocumentManifest {
  format: typeof CAPSAGE_DOCUMENT_FORMAT;
  formatVersion: typeof CAPSAGE_DOCUMENT_VERSION;
  createdAt: string;
  modifiedAt: string;
  image: {
    path: "image.png" | "image.jpg";
    mimeType: "image/png" | "image/jpeg";
    width: number;
    height: number;
    originX: number;
    originY: number;
  };
  captureStyle: CaptureStyle;
  callouts: Callout[];
  focusRegions: FocusRegion[];
  crop: CropRegion | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`The document has an invalid ${key} value.`);
  return value;
};

const requiredNumber = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`The document has an invalid ${key} value.`);
  }
  return value;
};

const optionalNumber = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`The document has an invalid ${key} value.`);
  }
  return value;
};

const parseCallout = (value: unknown): Callout => {
  if (!isRecord(value)) throw new Error("The document contains an invalid callout.");
  return {
    id: requiredString(value, "id"),
    x: requiredNumber(value, "x"),
    y: requiredNumber(value, "y"),
    width: requiredNumber(value, "width"),
    height: requiredNumber(value, "height"),
    text: requiredString(value, "text"),
    targetX: requiredNumber(value, "targetX"),
    targetY: requiredNumber(value, "targetY"),
    ...(optionalNumber(value, "minimumWidth") === undefined
      ? {}
      : { minimumWidth: optionalNumber(value, "minimumWidth") }),
    ...(optionalNumber(value, "manualWidth") === undefined
      ? {}
      : { manualWidth: optionalNumber(value, "manualWidth") })
  };
};

const parseFocus = (value: unknown): FocusRegion => {
  if (!isRecord(value)) throw new Error("The document contains an invalid focus region.");
  return {
    id: requiredString(value, "id"),
    x: requiredNumber(value, "x"),
    y: requiredNumber(value, "y"),
    width: requiredNumber(value, "width"),
    height: requiredNumber(value, "height")
  };
};

const parseCrop = (value: unknown): CropRegion | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error("The document contains an invalid crop region.");
  const crop = {
    x: requiredNumber(value, "x"),
    y: requiredNumber(value, "y"),
    width: requiredNumber(value, "width"),
    height: requiredNumber(value, "height")
  };
  if (crop.width <= 0 || crop.height <= 0) {
    throw new Error("The document contains an empty crop region.");
  }
  return crop;
};

const parseCaptureStyle = (value: unknown): CaptureStyle => {
  if (!isRecord(value)) throw new Error("The document contains an invalid capture style.");
  return {
    id: requiredString(value, "id"),
    name: requiredString(value, "name"),
    backgroundColor: requiredString(value, "backgroundColor"),
    borderThickness: requiredNumber(value, "borderThickness"),
    borderColor: requiredString(value, "borderColor"),
    textColor: requiredString(value, "textColor"),
    fontSize: requiredNumber(value, "fontSize"),
    fontFamily: requiredString(value, "fontFamily"),
    calloutScale: requiredNumber(value, "calloutScale"),
    unfocusedOpacity: requiredNumber(value, "unfocusedOpacity")
  };
};

export const createManifest = (
  capture: CaptureResult,
  state: EditorDocumentState,
  captureStyle: CaptureStyle,
  createdAt: string
): CapSageDocumentManifest => {
  const jpeg = capture.dataUrl.startsWith("data:image/jpeg;");
  return {
    format: CAPSAGE_DOCUMENT_FORMAT,
    formatVersion: CAPSAGE_DOCUMENT_VERSION,
    createdAt,
    modifiedAt: new Date().toISOString(),
    image: {
      path: jpeg ? "image.jpg" : "image.png",
      mimeType: jpeg ? "image/jpeg" : "image/png",
      width: capture.width,
      height: capture.height,
      originX: capture.originX,
      originY: capture.originY
    },
    captureStyle: { ...captureStyle },
    callouts: state.callouts.map((callout) => ({ ...callout })),
    focusRegions: state.focuses.map((focus) => ({ ...focus })),
    crop: state.crop ? { ...state.crop } : null
  };
};

export const parseManifest = (manifestJson: string) => {
  let value: unknown;
  try {
    value = JSON.parse(manifestJson);
  } catch {
    throw new Error("The CapSage document manifest is not valid JSON.");
  }
  if (!isRecord(value) || value.format !== CAPSAGE_DOCUMENT_FORMAT) {
    throw new Error("This is not a CapSage document.");
  }
  if (value.formatVersion !== 1 && value.formatVersion !== CAPSAGE_DOCUMENT_VERSION) {
    throw new Error(`CapSage cannot open document format version ${String(value.formatVersion)}.`);
  }
  if (!Array.isArray(value.callouts) || !Array.isArray(value.focusRegions)) {
    throw new Error("The CapSage document is missing its editable annotations.");
  }
  return {
    createdAt: requiredString(value, "createdAt"),
    captureStyle: parseCaptureStyle(value.captureStyle),
    state: {
      callouts: value.callouts.map(parseCallout),
      focuses: value.focusRegions.map(parseFocus),
      crop: parseCrop(value.crop)
    } satisfies EditorDocumentState
  };
};

export const emptyDocumentState = (): EditorDocumentState => ({ callouts: [], focuses: [], crop: null });
