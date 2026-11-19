import type { EmbeddingPoint } from '../../src/shared/insights';

// Pure layout math for the embedding map, kept apart from the component so it can be unit-tested.

export interface PlotSize {
  width: number;
  height: number;
}

export interface PlottedPoint {
  point: EmbeddingPoint;
  cx: number;
  cy: number;
  radius: number;
}

/** Space kept clear inside the plot edge so the largest dot is never clipped. */
export const PLOT_PADDING = 16;
const BASE_RADIUS = 4;
const MAX_EXTRA_RADIUS = 6;
/** A pointer within this distance of a dot counts as pointing at it. */
export const HIT_DISTANCE = 24;

/** Dot radius in pixels: at least 4, growing with the retrieval count up to 10. */
export function dotRadius(retrievalCount: number): number {
  return BASE_RADIUS + Math.min(retrievalCount * 0.5, MAX_EXTRA_RADIUS);
}

/** A plot height that suits the available width: wide on desktop, closer to square on a phone. */
export function plotHeight(width: number): number {
  return Math.round(Math.min(Math.max(width * 0.6, 260), 460));
}

/**
 * Converts map coordinates (-1 to 1, y up) to pixels (y down). The result is
 * ordered largest dot first, so small dots are drawn on top and stay visible.
 */
export function layoutPoints(points: EmbeddingPoint[], size: PlotSize): PlottedPoint[] {
  const innerWidth = Math.max(size.width - 2 * PLOT_PADDING, 0);
  const innerHeight = Math.max(size.height - 2 * PLOT_PADDING, 0);
  return points
    .map((point) => ({
      point,
      cx: PLOT_PADDING + ((point.x + 1) / 2) * innerWidth,
      cy: PLOT_PADDING + ((1 - point.y) / 2) * innerHeight,
      radius: dotRadius(point.retrievalCount),
    }))
    .sort((a, b) => b.radius - a.radius);
}

/** The dot closest to a pointer position, or null if none is within reach. */
export function nearestPoint(plotted: PlottedPoint[], x: number, y: number): PlottedPoint | null {
  let nearest: PlottedPoint | null = null;
  let nearestDistance = Infinity;
  for (const candidate of plotted) {
    const distance = Math.hypot(candidate.cx - x, candidate.cy - y) - candidate.radius;
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= HIT_DISTANCE ? nearest : null;
}
