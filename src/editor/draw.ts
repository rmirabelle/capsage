import { arrowStart } from "./geometry";
import type { Callout, CropRegion, FocusRegion } from "./types";
import {
  DEFAULT_CAPTURE_STYLE,
  FOCUS_BLUR,
  FOCUS_RADIUS,
  MAX_AUTO_CALLOUT_WIDTH,
  calloutFontSize,
  calloutPaddingX,
  calloutPaddingY,
  captureStyleFont,
  captureStyleLineHeight,
  minCalloutWidth,
  type CaptureStyle
} from "./style";

function addFocusPath(ctx: CanvasRenderingContext2D, focus: FocusRegion) {
  ctx.roundRect(focus.x, focus.y, focus.width, focus.height, FOCUS_RADIUS);
}

function drawFocusEffect(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  focuses: FocusRegion[],
  style: CaptureStyle,
  viewport: CropRegion
) {
  if (!focuses.length) return;

  const effectLayer = document.createElement("canvas");
  effectLayer.width = ctx.canvas.width;
  effectLayer.height = ctx.canvas.height;
  const effect = effectLayer.getContext("2d")!;
  effect.fillStyle = style.backgroundColor;
  effect.fillRect(0, 0, effectLayer.width, effectLayer.height);
  effect.globalAlpha = style.unfocusedOpacity;
  effect.filter = `blur(${FOCUS_BLUR}px)`;
  effect.drawImage(
    image,
    viewport.x,
    viewport.y,
    viewport.width,
    viewport.height,
    0,
    0,
    effectLayer.width,
    effectLayer.height
  );
  effect.filter = "none";
  effect.globalAlpha = 1;
  effect.globalCompositeOperation = "destination-out";
  effect.fillStyle = "#000";
  focuses.forEach((focus) => {
    effect.beginPath();
    addFocusPath(effect, focus);
    effect.fill();
  });
  ctx.drawImage(effectLayer, 0, 0);

  focuses.forEach((focus) => {
    if (style.borderThickness === 0) return;
    ctx.save();
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = style.borderThickness;
    ctx.beginPath();
    addFocusPath(ctx, focus);
    ctx.stroke();
    ctx.restore();
  });
}

function addCalloutSilhouette(ctx: CanvasRenderingContext2D, callout: Callout, style: CaptureStyle) {
  const scale = style.calloutScale;
  const left = callout.x;
  const top = callout.y;
  const right = callout.x + callout.width;
  const bottom = callout.y + callout.height;
  const radius = Math.min(18 * scale, callout.width / 2, callout.height / 2);
  const end = { x: callout.targetX, y: callout.targetY };
  const targetInside = end.x >= left && end.x <= right && end.y >= top && end.y <= bottom;

  ctx.beginPath();
  if (targetInside) {
    ctx.roundRect(left, top, callout.width, callout.height, radius);
    return;
  }

  const edgeHit = arrowStart(callout);
  const sideDistances = {
    top: Math.abs(edgeHit.y - top),
    right: Math.abs(edgeHit.x - right),
    bottom: Math.abs(edgeHit.y - bottom),
    left: Math.abs(edgeHit.x - left)
  };
  const side = (Object.entries(sideDistances).sort((a, b) => a[1] - b[1])[0][0]) as keyof typeof sideDistances;
  let shaftHalfWidth = 7 * scale;
  const headHalfWidth = 17 * scale;
  const attachment = { ...edgeHit };
  const clamp = (value: number, minimum: number, maximum: number) =>
    minimum <= maximum ? Math.max(minimum, Math.min(maximum, value)) : (minimum + maximum) / 2;

  // At an angle, a constant-width shaft projects to a wider opening on the
  // box edge. Re-clamp using that projected half-width so both parallel sides
  // intersect the straight portion of the box rather than a rounded corner.
  for (let pass = 0; pass < 2; pass += 1) {
    const passDx = end.x - attachment.x;
    const passDy = end.y - attachment.y;
    const passLength = Math.max(0.0001, Math.hypot(passDx, passDy));
    const normalComponent = side === "top" || side === "bottom"
      ? Math.abs(passDy / passLength)
      : Math.abs(passDx / passLength);
    const availableProjectedHalf = side === "top" || side === "bottom"
      ? Math.max(scale, callout.width / 2 - radius)
      : Math.max(scale, callout.height / 2 - radius);
    if (shaftHalfWidth / Math.max(0.0001, normalComponent) > availableProjectedHalf) {
      shaftHalfWidth = Math.max(scale, availableProjectedHalf * normalComponent);
    }
    const projectedHalfWidth = shaftHalfWidth / Math.max(0.0001, normalComponent);
    if (side === "top" || side === "bottom") {
      attachment.x = clamp(edgeHit.x, left + radius + projectedHalfWidth, right - radius - projectedHalfWidth);
      attachment.y = side === "top" ? top : bottom;
    } else {
      attachment.x = side === "left" ? left : right;
      attachment.y = clamp(edgeHit.y, top + radius + projectedHalfWidth, bottom - radius - projectedHalfWidth);
    }
  }

  const dx = end.x - attachment.x;
  const dy = end.y - attachment.y;
  const length = Math.hypot(dx, dy);
  if (length < 2 * scale) {
    ctx.roundRect(left, top, callout.width, callout.height, radius);
    return;
  }

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const headLength = Math.min(26 * scale, length * 0.45);
  const neck = { x: end.x - ux * headLength, y: end.y - uy * headLength };
  const neckPlus = { x: neck.x + px * shaftHalfWidth, y: neck.y + py * shaftHalfWidth };
  const neckMinus = { x: neck.x - px * shaftHalfWidth, y: neck.y - py * shaftHalfWidth };
  const headPlus = { x: neck.x + px * headHalfWidth, y: neck.y + py * headHalfWidth };
  const headMinus = { x: neck.x - px * headHalfWidth, y: neck.y - py * headHalfWidth };
  const shaftEdgeIntersection = (sign: 1 | -1) => {
    const offset = {
      x: attachment.x + px * shaftHalfWidth * sign,
      y: attachment.y + py * shaftHalfWidth * sign
    };
    if (side === "top" || side === "bottom") {
      const t = (attachment.y - offset.y) / uy;
      return { x: offset.x + ux * t, y: attachment.y };
    }
    const t = (attachment.x - offset.x) / ux;
    return { x: attachment.x, y: offset.y + uy * t };
  };
  const attachmentPlus = shaftEdgeIntersection(1);
  const attachmentMinus = shaftEdgeIntersection(-1);
  const plusComesFirst = side === "top"
    ? attachmentPlus.x < attachmentMinus.x
    : side === "right"
      ? attachmentPlus.y < attachmentMinus.y
      : side === "bottom"
        ? attachmentPlus.x > attachmentMinus.x
        : attachmentPlus.y > attachmentMinus.y;
  const attachmentStart = plusComesFirst ? attachmentPlus : attachmentMinus;
  const attachmentEnd = plusComesFirst ? attachmentMinus : attachmentPlus;

  // The rounded rectangle is traced clockwise from attachmentEnd all the way
  // around to attachmentStart, deliberately omitting the edge under the arrow.
  if (side === "top") {
    ctx.moveTo(attachmentEnd.x, attachmentEnd.y);
    ctx.lineTo(right - radius, top);
    ctx.arcTo(right, top, right, top + radius, radius);
    ctx.lineTo(right, bottom - radius);
    ctx.arcTo(right, bottom, right - radius, bottom, radius);
    ctx.lineTo(left + radius, bottom);
    ctx.arcTo(left, bottom, left, bottom - radius, radius);
    ctx.lineTo(left, top + radius);
    ctx.arcTo(left, top, left + radius, top, radius);
    ctx.lineTo(attachmentStart.x, attachmentStart.y);
  } else if (side === "right") {
    ctx.moveTo(attachmentEnd.x, attachmentEnd.y);
    ctx.lineTo(right, bottom - radius);
    ctx.arcTo(right, bottom, right - radius, bottom, radius);
    ctx.lineTo(left + radius, bottom);
    ctx.arcTo(left, bottom, left, bottom - radius, radius);
    ctx.lineTo(left, top + radius);
    ctx.arcTo(left, top, left + radius, top, radius);
    ctx.lineTo(right - radius, top);
    ctx.arcTo(right, top, right, top + radius, radius);
    ctx.lineTo(attachmentStart.x, attachmentStart.y);
  } else if (side === "bottom") {
    ctx.moveTo(attachmentEnd.x, attachmentEnd.y);
    ctx.lineTo(left + radius, bottom);
    ctx.arcTo(left, bottom, left, bottom - radius, radius);
    ctx.lineTo(left, top + radius);
    ctx.arcTo(left, top, left + radius, top, radius);
    ctx.lineTo(right - radius, top);
    ctx.arcTo(right, top, right, top + radius, radius);
    ctx.lineTo(right, bottom - radius);
    ctx.arcTo(right, bottom, right - radius, bottom, radius);
    ctx.lineTo(attachmentStart.x, attachmentStart.y);
  } else {
    ctx.moveTo(attachmentEnd.x, attachmentEnd.y);
    ctx.lineTo(left, top + radius);
    ctx.arcTo(left, top, left + radius, top, radius);
    ctx.lineTo(right - radius, top);
    ctx.arcTo(right, top, right, top + radius, radius);
    ctx.lineTo(right, bottom - radius);
    ctx.arcTo(right, bottom, right - radius, bottom, radius);
    ctx.lineTo(left + radius, bottom);
    ctx.arcTo(left, bottom, left, bottom - radius, radius);
    ctx.lineTo(attachmentStart.x, attachmentStart.y);
  }

  const firstNeck = plusComesFirst ? neckPlus : neckMinus;
  const firstHead = plusComesFirst ? headPlus : headMinus;
  const secondHead = plusComesFirst ? headMinus : headPlus;
  const secondNeck = plusComesFirst ? neckMinus : neckPlus;
  ctx.lineTo(firstNeck.x, firstNeck.y);
  ctx.lineTo(firstHead.x, firstHead.y);
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(secondHead.x, secondHead.y);
  ctx.lineTo(secondNeck.x, secondNeck.y);
  ctx.lineTo(attachmentEnd.x, attachmentEnd.y);
  ctx.closePath();
}

function breakLongWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number) {
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    const candidate = piece + character;
    if (piece && ctx.measureText(candidate).width > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

export function wrapCalloutText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const output: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push("");
      continue;
    }
    let line = "";
    for (const sourceWord of words) {
      const wordPieces = ctx.measureText(sourceWord).width > maxWidth
        ? breakLongWord(ctx, sourceWord, maxWidth)
        : [sourceWord];
      for (const word of wordPieces) {
      const candidate = `${line} ${word}`;
        if (!line) line = word;
        else if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        output.push(line);
        line = word;
      }
      }
    }
    output.push(line);
  }
  return output;
}

export function measureCalloutForText(
  ctx: CanvasRenderingContext2D,
  text: string,
  availableWidth: number,
  style: CaptureStyle = DEFAULT_CAPTURE_STYLE
) {
  ctx.save();
  ctx.font = captureStyleFont(style);
  const scale = style.calloutScale;
  const paddingX = calloutPaddingX(style);
  const paddingY = calloutPaddingY(style);
  const minimumWidth = minCalloutWidth(style);
  const maxOuterWidth = Math.max(
    minimumWidth,
    Math.min(MAX_AUTO_CALLOUT_WIDTH * scale, availableWidth)
  );
  const maxContentWidth = Math.max(40 * scale, maxOuterWidth - paddingX * 2);
  const longestExplicitLine = Math.max(
    0,
    ...text.split("\n").map((line) => ctx.measureText(line || " ").width)
  );
  const contentWidth = Math.max(
    minimumWidth - paddingX * 2,
    Math.min(maxContentWidth, Math.ceil(longestExplicitLine))
  );
  const lines = wrapCalloutText(ctx, text, contentWidth);
  ctx.restore();
  return {
    width: Math.ceil(contentWidth + paddingX * 2),
    height: Math.ceil(lines.length * captureStyleLineHeight(style) + paddingY * 2)
  };
}

export function measureCalloutHeightForWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  outerWidth: number,
  style: CaptureStyle = DEFAULT_CAPTURE_STYLE
) {
  ctx.save();
  ctx.font = captureStyleFont(style);
  const paddingX = calloutPaddingX(style);
  const paddingY = calloutPaddingY(style);
  const contentWidth = Math.max(40 * style.calloutScale, outerWidth - paddingX * 2);
  const lineCount = Math.max(1, wrapCalloutText(ctx, text, contentWidth).length);
  ctx.restore();
  return lineCount * captureStyleLineHeight(style) + paddingY * 2;
}

export function drawCallout(ctx: CanvasRenderingContext2D, callout: Callout, style: CaptureStyle) {
  const scale = style.calloutScale;
  const paddingX = calloutPaddingX(style);
  const paddingY = calloutPaddingY(style);
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 20 * scale;
  ctx.shadowOffsetY = 7 * scale;
  ctx.fillStyle = style.backgroundColor;
  ctx.strokeStyle = style.borderColor;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  addCalloutSilhouette(ctx, callout, style);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (style.borderThickness > 0) {
    ctx.lineWidth = style.borderThickness * scale;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.rect(
    callout.x + paddingX,
    callout.y + paddingY,
    callout.width - paddingX * 2,
    callout.height - paddingY * 2
  );
  ctx.clip();
  ctx.fillStyle = style.textColor;
  ctx.font = captureStyleFont(style);
  ctx.textBaseline = "top";
  const lineHeight = captureStyleLineHeight(style);
  const lines = wrapCalloutText(
    ctx,
    callout.text,
    callout.width - paddingX * 2
  );
  const textTop =
    callout.y +
    (callout.height - lines.length * lineHeight) / 2 +
    (lineHeight - calloutFontSize(style)) / 2;
  lines.forEach((line, index) =>
    ctx.fillText(
      line,
      callout.x + paddingX,
      textTop + index * lineHeight
    )
  );
  ctx.restore();
}

function selectionHandle(ctx: CanvasRenderingContext2D, x: number, y: number, style: CaptureStyle) {
  ctx.fillStyle = "#22252f";
  ctx.strokeStyle = style.borderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(x - 6, y - 6, 12, 12);
  ctx.fill();
  ctx.stroke();
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  callouts: Callout[],
  focuses: FocusRegion[],
  selectedId?: string | null,
  includeSelection = true,
  style: CaptureStyle = DEFAULT_CAPTURE_STYLE,
  viewport: CropRegion = {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight
  }
) {
  const visibleCallouts = callouts.map((callout) => ({
    ...callout,
    x: callout.x - viewport.x,
    y: callout.y - viewport.y,
    targetX: callout.targetX - viewport.x,
    targetY: callout.targetY - viewport.y
  }));
  const visibleFocuses = focuses.map((focus) => ({
    ...focus,
    x: focus.x - viewport.x,
    y: focus.y - viewport.y
  }));
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(
    image,
    viewport.x,
    viewport.y,
    viewport.width,
    viewport.height,
    0,
    0,
    ctx.canvas.width,
    ctx.canvas.height
  );
  drawFocusEffect(ctx, image, visibleFocuses, style, viewport);
  visibleCallouts.forEach((callout) => drawCallout(ctx, callout, style));

  if (!includeSelection || !selectedId) return;
  const selectedCallout = visibleCallouts.find((callout) => callout.id === selectedId);
  const selectedFocus = visibleFocuses.find((focus) => focus.id === selectedId);
  const selected = selectedCallout ?? selectedFocus;
  if (!selected) return;

  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = style.borderColor;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(selected.x - 5, selected.y - 5, selected.width + 10, selected.height + 10);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  if (selectedCallout) {
    selectionHandle(ctx, selected.x, selected.y + selected.height / 2, style);
    selectionHandle(ctx, selected.x + selected.width, selected.y + selected.height / 2, style);
    ctx.fillStyle = "#22252f";
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(selectedCallout.targetX, selectedCallout.targetY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    const centerX = selected.x + selected.width / 2;
    const centerY = selected.y + selected.height / 2;
    [
      [selected.x, selected.y],
      [centerX, selected.y],
      [selected.x + selected.width, selected.y],
      [selected.x, centerY],
      [selected.x + selected.width, centerY],
      [selected.x, selected.y + selected.height],
      [centerX, selected.y + selected.height],
      [selected.x + selected.width, selected.y + selected.height]
    ].forEach(([x, y]) => selectionHandle(ctx, x, y, style));
  }
  ctx.restore();
}
