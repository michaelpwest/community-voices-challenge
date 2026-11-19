import { describe, expect, it } from 'vitest';
import { projectToTwoDimensions } from './projection';

const vector = (...values: number[]): Float32Array => Float32Array.from(values);

describe('projectToTwoDimensions', () => {
  it('puts the direction of greatest variation on the first axis and the next on the second', () => {
    // Spread widely along dimension 0, a little along dimension 2, not at all along the others.
    const vectors = [vector(-10, 5, -1, 0), vector(-5, 5, 1, 0), vector(0, 5, 0, 0), vector(5, 5, -1, 0), vector(10, 5, 1, 0)];
    const { points, explainedVariance } = projectToTwoDimensions(vectors);
    const xs = points.map(([x]) => x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[0]).toBeCloseTo(-1);
    expect(xs[4]).toBeCloseTo(1);
    expect(Math.abs(points[2]?.[1] ?? 1)).toBeLessThan(0.01);
    expect(explainedVariance[0]).toBeGreaterThan(0.95);
    expect(explainedVariance[0] + explainedVariance[1]).toBeCloseTo(1);
  });

  it('keeps similar vectors close together and different ones apart', () => {
    const vectors = [vector(1, 0, 0), vector(0.9, 0.1, 0), vector(0, 0, 1), vector(0, 0.1, 0.9)];
    const { points } = projectToTwoDimensions(vectors);
    const distance = (a: number, b: number): number =>
      Math.hypot((points[a]?.[0] ?? 0) - (points[b]?.[0] ?? 0), (points[a]?.[1] ?? 0) - (points[b]?.[1] ?? 0));
    expect(distance(0, 1)).toBeLessThan(distance(0, 2) / 5);
    expect(distance(2, 3)).toBeLessThan(distance(1, 3) / 5);
  });

  it('scales every coordinate into the range -1 to 1', () => {
    const vectors = Array.from({ length: 30 }, (_, index) => vector(Math.sin(index) * 500, Math.cos(index * 2) * 80, index));
    const { points } = projectToTwoDimensions(vectors);
    const largest = Math.max(...points.flat().map(Math.abs));
    expect(largest).toBeCloseTo(1);
  });

  it('gives the same result every time', () => {
    const vectors = Array.from({ length: 20 }, (_, index) => vector(Math.sin(index), Math.cos(index * 3), index % 4, index * 0.1));
    expect(projectToTwoDimensions(vectors)).toEqual(projectToTwoDimensions(vectors));
  });

  it('is not affected by the order of the vectors', () => {
    const vectors = [vector(3, 1, 0), vector(-2, 0, 1), vector(0, 4, -1), vector(5, -3, 2)];
    const forward = projectToTwoDimensions(vectors).points;
    const backward = projectToTwoDimensions([...vectors].reverse()).points.reverse();
    forward.forEach(([x, y], index) => {
      expect(backward[index]?.[0]).toBeCloseTo(x);
      expect(backward[index]?.[1]).toBeCloseTo(y);
    });
  });

  it('handles no vectors, one vector, and identical vectors', () => {
    expect(projectToTwoDimensions([])).toEqual({ points: [], explainedVariance: [0, 0] });
    expect(projectToTwoDimensions([vector(1, 2, 3)])).toEqual({ points: [[0, 0]], explainedVariance: [0, 0] });
    expect(projectToTwoDimensions([vector(1, 2), vector(1, 2)]).points).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('places vectors that differ along a single line on one axis', () => {
    const { points, explainedVariance } = projectToTwoDimensions([vector(0, 0), vector(1, 1), vector(2, 2)]);
    expect(points.map(([, y]) => Math.abs(y)).every((y) => y < 1e-6)).toBe(true);
    expect(explainedVariance[0]).toBeCloseTo(1);
    expect(explainedVariance[1]).toBeCloseTo(0);
  });

  it('rejects vectors of different sizes', () => {
    expect(() => projectToTwoDimensions([vector(1, 2), vector(1, 2, 3)])).toThrow(/same number of dimensions/);
  });
});
