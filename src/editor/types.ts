export type CaptureMode = "window" | "region";

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Callout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  targetX: number;
  targetY: number;
  minimumWidth?: number;
  manualWidth?: number;
}

export interface FocusRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
