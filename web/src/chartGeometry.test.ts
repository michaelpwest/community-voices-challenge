import { describe, expect, it } from 'vitest';
import type { EmbeddingPoint } from '../../src/shared/insights';
import { dotRadius, HIT_DISTANCE, layoutPoints, nearestPoint, PLOT_PADDING, plotHeight } from './chartGeometry';

function point(name: string, x: number, y: number, retrievalCount = 0): EmbeddingPoint {
  return {
    discussionId: name,
    kind: 'post',
    title: name,
    url: `https://test.invalid/${name}`,
    postedAt: '2026-01-14T10:00:00.000Z',
    x,
    y,
    retrievalCount,
  };
}

const SIZE = { width: 432, height: 232 };

describe('dotRadius', () => {
  it('starts at a readable 4 pixels and grows with retrievals up to a limit', () => {
    expect(dotRadius(0)).toBe(4);
    expect(dotRadius(4)).toBe(6);
    expect(dotRadius(12)).toBe(10);
    expect(dotRadius(500)).toBe(10);
  });
});

describe('plotHeight', () => {
  it('follows the width between a minimum and a maximum', () => {
    expect(plotHeight(300)).toBe(260);
    expect(plotHeight(600)).toBe(360);
    expect(plotHeight(1200)).toBe(460);
  });
});

describe('layoutPoints', () => {
  it('maps the corners and center of the map into the padded plot, with y pointing up', () => {
    const plotted = layoutPoints([point('center', 0, 0), point('top-right', 1, 1), point('bottom-left', -1, -1)], SIZE);
    const at = (name: string) => plotted.find((item) => item.point.discussionId === name);
    expect(at('center')).toMatchObject({ cx: 216, cy: 116 });
    expect(at('top-right')).toMatchObject({ cx: SIZE.width - PLOT_PADDING, cy: PLOT_PADDING });
    expect(at('bottom-left')).toMatchObject({ cx: PLOT_PADDING, cy: SIZE.height - PLOT_PADDING });
  });

  it('orders larger dots first so smaller ones are drawn on top', () => {
    const plotted = layoutPoints([point('small', 0, 0, 0), point('large', 0, 0, 8), point('medium', 0, 0, 2)], SIZE);
    expect(plotted.map((item) => item.point.discussionId)).toEqual(['large', 'medium', 'small']);
  });

  it('keeps even the largest dot inside the plot', () => {
    const [corner] = layoutPoints([point('corner', 1, 1, 100)], SIZE);
    expect((corner?.cx ?? 0) + (corner?.radius ?? 0)).toBeLessThanOrEqual(SIZE.width);
    expect((corner?.cy ?? 0) - (corner?.radius ?? 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('nearestPoint', () => {
  const plotted = layoutPoints([point('left', -0.5, 0), point('right', 0.5, 0)], SIZE);

  it('finds the closest dot without needing to be exactly on it', () => {
    expect(nearestPoint(plotted, 120, 124)?.point.discussionId).toBe('left');
    expect(nearestPoint(plotted, 310, 110)?.point.discussionId).toBe('right');
  });

  it('returns nothing when no dot is within reach', () => {
    const left = plotted.find((item) => item.point.discussionId === 'left');
    const justOutOfReach = (left?.cx ?? 0) - (left?.radius ?? 0) - HIT_DISTANCE - 1;
    expect(nearestPoint(plotted, justOutOfReach, left?.cy ?? 0)).toBeNull();
    expect(nearestPoint([], 10, 10)).toBeNull();
  });
});
