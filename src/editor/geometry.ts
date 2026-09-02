import type { Callout, CropRegion, FocusRegion, Point } from "./types";

export function normalizeRect(start: Point, end: Point) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

export function pointInCallout(point: Point, callout: Callout) {
  return (
    point.x >= callout.x &&
    point.x <= callout.x + callout.width &&
    point.y >= callout.y &&
    point.y <= callout.y + callout.height
  );
}

export function pointInFocus(point: Point, focus: FocusRegion | CropRegion) {
  return (
    point.x >= focus.x &&
    point.x <= focus.x + focus.width &&
    point.y >= focus.y &&
    point.y <= focus.y + focus.height
  );
}

/** Finds the box edge hit by a ray from the callout center toward its target. */
export function arrowStart(callout: Callout): Point {
  const centerX = callout.x + callout.width / 2;
  const centerY = callout.y + callout.height / 2;
  const dx = callout.targetX - centerX;
  const dy = callout.targetY - centerY;

  if (dx === 0 && dy === 0) return { x: centerX, y: callout.y + callout.height };

  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : callout.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : callout.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
