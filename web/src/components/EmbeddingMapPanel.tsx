import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { EmbeddingMap, EmbeddingPoint } from '../../../src/shared/insights';
import { layoutPoints, nearestPoint, plotHeight, type PlottedPoint } from '../chartGeometry';
import { formatPercent, formatTimes, formatUtcDay } from '../format';
import { Disclosure, ExternalLink, Hint, Panel } from './ui';

const SERIES = {
  post: { label: 'Posts', fill: 'fill-series-1', swatch: 'bg-series-1' },
  comment: { label: 'Comments', fill: 'fill-series-2', swatch: 'bg-series-2' },
};

const describe = (point: EmbeddingPoint): string =>
  `${point.kind === 'post' ? 'Post' : 'Comment'}, ${formatUtcDay(point.postedAt)}, retrieved ${formatTimes(point.retrievalCount)}`;

/** Tracks an element's width so the chart can be drawn in real pixels at any screen size. */
function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Legend() {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" aria-label="Legend">
      {Object.values(SERIES).map((series) => (
        <li key={series.label} className="flex items-center gap-1.5">
          <span className={`inline-block size-2.5 rounded-full ${series.swatch}`} aria-hidden="true" />
          {series.label}
        </li>
      ))}
      <li className="text-muted">A larger dot was retrieved more often.</li>
    </ul>
  );
}

/** A small card beside the dot under the pointer, kept inside the plot. */
function Tooltip({ target, width, height }: { target: PlottedPoint; width: number; height: number }) {
  const horizontal = target.cx > width / 2 ? { right: width - target.cx + 12 } : { left: target.cx + 12 };
  const vertical = target.cy > height / 2 ? { bottom: height - target.cy + 12 } : { top: target.cy + 12 };
  return (
    <div
      role="tooltip"
      style={{ ...horizontal, ...vertical }}
      className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm shadow-md"
    >
      <p className="line-clamp-2 font-semibold">{target.point.title}</p>
      <p className="text-muted">{describe(target.point)}</p>
    </div>
  );
}

function Plot({ points, onSelect }: { points: EmbeddingPoint[]; onSelect: (point: EmbeddingPoint | null) => void }) {
  const { ref, width } = useElementWidth();
  const [hovered, setHovered] = useState<PlottedPoint | null>(null);
  const height = plotHeight(width);
  const plotted = width > 0 ? layoutPoints(points, { width, height }) : [];

  // The pointer only needs to be near a dot, not exactly on it.
  const pointAt = (event: MouseEvent<SVGSVGElement>): PlottedPoint | null => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return nearestPoint(plotted, event.clientX - bounds.left, event.clientY - bounds.top);
  };

  return (
    <div ref={ref} className="relative mt-3">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Scatter plot of ${points.length} embeddings. The same data is available as a table below.`}
          className="touch-manipulation rounded-md border border-line"
          onPointerMove={(event) => setHovered(pointAt(event))}
          onPointerLeave={() => setHovered(null)}
          onClick={(event) => onSelect(pointAt(event)?.point ?? null)}
        >
          <line x1={width / 2} y1={0} x2={width / 2} y2={height} className="stroke-line" />
          <line x1={0} y1={height / 2} x2={width} y2={height / 2} className="stroke-line" />
          {plotted.map(({ point, cx, cy, radius }) => (
            // The surface-colored ring keeps overlapping dots distinguishable.
            <circle
              key={point.discussionId}
              cx={cx}
              cy={cy}
              r={radius}
              strokeWidth={2}
              className={`stroke-surface ${SERIES[point.kind].fill}`}
            />
          ))}
          {hovered && (
            <circle cx={hovered.cx} cy={hovered.cy} r={hovered.radius + 3} strokeWidth={2} className="fill-none stroke-ink" />
          )}
        </svg>
      )}
      {hovered && <Tooltip target={hovered} width={width} height={height} />}
    </div>
  );
}

function PointsTable({ points }: { points: EmbeddingPoint[] }) {
  const cell = 'border-t border-line px-2.5 py-1.5 text-left align-top';
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            {['Discussion', 'Kind', 'Posted', 'Retrieved', 'X', 'Y'].map((heading) => (
              <th key={heading} scope="col" className="px-2.5 py-1.5 text-left font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.discussionId}>
              <td className={`${cell} wrap-anywhere`}>
                <ExternalLink href={point.url}>{point.title}</ExternalLink>
              </td>
              <td className={cell}>{point.kind === 'post' ? 'Post' : 'Comment'}</td>
              <td className={`${cell} whitespace-nowrap`}>{formatUtcDay(point.postedAt)}</td>
              <td className={`${cell} tabular-nums`}>{point.retrievalCount}</td>
              <td className={`${cell} tabular-nums`}>{point.x.toFixed(2)}</td>
              <td className={`${cell} tabular-nums`}>{point.y.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The week's embeddings flattened to two dimensions, so similar discussions sit near each other. */
export function EmbeddingMapPanel({ map }: { map: EmbeddingMap }) {
  const [selected, setSelected] = useState<EmbeddingPoint | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const kept = map.explainedVariance[0] + map.explainedVariance[1];

  return (
    <Panel aria-labelledby="embedding-map-heading">
      <h3 id="embedding-map-heading" className="text-lg font-semibold">
        Map of this week&rsquo;s embeddings
      </h3>
      {map.points.length === 0 ? (
        <Hint>No embeddings from the past week yet. Refresh the feed to create them.</Hint>
      ) : (
        <>
          <Hint>
            Each dot is one post or comment, placed by flattening its {map.embeddingModel} embedding to two dimensions.
            Dots that sit close together tend to be about similar things.
          </Hint>
          <Legend />
          <Plot points={map.points} onSelect={setSelected} />
          <p className="mt-2 min-h-6 text-sm wrap-anywhere" aria-live="polite">
            {selected ? (
              <>
                <ExternalLink href={selected.url}>{selected.title}</ExternalLink>{' '}
                <span className="text-muted">({describe(selected)})</span>
              </>
            ) : (
              <span className="text-muted">Point at a dot to see what it is; select one to get its link.</span>
            )}
          </p>
          <Hint>
            Flattened with principal component analysis. The two axes keep {formatPercent(kept)} of the variation in the
            original embeddings, so positions are a rough guide and not exact distances.
          </Hint>
          <Disclosure
            title={`View these ${map.points.length} embeddings as a table`}
            onToggle={(event) => setTableOpen(event.currentTarget.open)}
          >
            {tableOpen && <PointsTable points={map.points} />}
          </Disclosure>
        </>
      )}
    </Panel>
  );
}
