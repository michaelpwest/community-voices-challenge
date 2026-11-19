/** The result of flattening vectors to two dimensions. */
export interface Projection {
  /** One [x, y] pair per input vector, scaled so the largest coordinate is 1 in size. */
  points: Array<[number, number]>;
  /** Share of the total variation kept by each axis, from 0 to 1. */
  explainedVariance: [number, number];
}

const MAX_ITERATIONS = 200;
const CONVERGED = 1e-10;
const NEGLIGIBLE = 1e-9;

type Vector = Float64Array;

// These loops run millions of times for a week of embeddings, so they use
// plain indexed loops instead of array callbacks.

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0);
  return sum;
}

/** Adds `scale * source` to `target` in place. */
function addScaled(target: Vector, source: ArrayLike<number>, scale: number): void {
  for (let index = 0; index < target.length; index += 1) target[index] = (target[index] ?? 0) + scale * (source[index] ?? 0);
}

/** Scales the vector to length 1 in place and returns its original length. */
function normalize(vector: Vector): number {
  const length = Math.sqrt(dot(vector, vector));
  if (length > 0) for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / length;
  return length;
}

/** Subtracts the average vector so the cloud of points is centered on the origin. */
function center(vectors: Float32Array[], dimensions: number): Vector[] {
  const mean = new Float64Array(dimensions);
  for (const vector of vectors) addScaled(mean, vector, 1 / vectors.length);
  return vectors.map((vector) => {
    const row = Float64Array.from(vector);
    addScaled(row, mean, -1);
    return row;
  });
}

/** A direction and its opposite describe the same axis; this picks one consistently. */
function withConsistentSign(direction: Vector): Vector {
  let largest = 0;
  for (const value of direction) if (Math.abs(value) > Math.abs(largest)) largest = value;
  return largest < 0 ? direction.map((value) => -value) : direction;
}

/**
 * Finds the direction along which the rows vary most, ignoring the directions
 * already found. Uses power iteration: repeatedly applying the data to a guess
 * turns it toward the dominant direction.
 */
function principalDirection(rows: Vector[], dimensions: number, found: Vector[], totalVariation: number): Vector {
  // A fixed starting guess keeps the result identical from run to run.
  let direction = Float64Array.from({ length: dimensions }, (_, index) => Math.sin(index + 1 + found.length));
  normalize(direction);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const next = new Float64Array(dimensions);
    for (const row of rows) addScaled(next, row, dot(row, direction));
    for (const earlier of found) addScaled(next, earlier, -dot(next, earlier));
    // What is left is rounding noise: the data does not vary in any further direction.
    if (normalize(next) <= NEGLIGIBLE * totalVariation) return new Float64Array(dimensions);
    const change = 1 - Math.abs(dot(next, direction));
    direction = next;
    if (change < CONVERGED) break;
  }
  return withConsistentSign(direction);
}

/**
 * Flattens high-dimensional vectors to two dimensions with principal component
 * analysis: the map's axes are the two directions along which the vectors
 * differ most, so vectors that are close in meaning tend to stay close on the
 * map. The result is deterministic.
 */
export function projectToTwoDimensions(vectors: Float32Array[]): Projection {
  const dimensions = vectors[0]?.length ?? 0;
  if (vectors.some((vector) => vector.length !== dimensions)) {
    throw new Error('All vectors must have the same number of dimensions.');
  }
  const rows = center(vectors, dimensions);
  const totalVariation = rows.reduce((sum, row) => sum + dot(row, row), 0);
  if (totalVariation === 0) {
    return { points: vectors.map(() => [0, 0]), explainedVariance: [0, 0] };
  }

  const first = principalDirection(rows, dimensions, [], totalVariation);
  const second = principalDirection(rows, dimensions, [first], totalVariation);
  const raw = rows.map((row): [number, number] => [dot(row, first), dot(row, second)]);
  const variationAlong = (axis: 0 | 1): number => raw.reduce((sum, point) => sum + point[axis] ** 2, 0);
  const extent = raw.reduce((largest, [x, y]) => Math.max(largest, Math.abs(x), Math.abs(y)), 0) || 1;

  return {
    points: raw.map(([x, y]) => [x / extent, y / extent]),
    explainedVariance: [variationAlong(0) / totalVariation, variationAlong(1) / totalVariation],
  };
}
