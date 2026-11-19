import type { RetrievalStats } from '../../../src/shared/insights';
import { formatDateTime } from '../format';
import { ExternalLink, Hint, Panel } from './ui';

const CELL = 'border-t border-line px-2.5 py-2 text-left align-top';
const COLUMN_HEADING = 'px-2.5 py-2 text-left text-xs font-semibold text-muted';

/** Which stored discussions similarity search returns most often. */
export function RetrievalStatsPanel({ stats }: { stats: RetrievalStats }) {
  return (
    <Panel aria-labelledby="retrieval-stats-heading">
      <h3 id="retrieval-stats-heading" className="text-lg font-semibold">
        Most retrieved discussions
      </h3>
      {stats.totalRetrievals === 0 ? (
        <Hint>
          Nothing has been retrieved yet. Each time similarity search returns a discussion it is counted here; generating
          reports runs several searches.
        </Hint>
      ) : (
        <>
          <Hint>
            Counted each time similarity search returns a discussion, when gathering report evidence or through the
            search API. So far: {stats.totalRetrievals} retrievals of {stats.discussionsRetrieved} different
            discussions.
          </Hint>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={COLUMN_HEADING}>
                  Discussion
                </th>
                <th scope="col" className={COLUMN_HEADING}>
                  Times retrieved
                </th>
                <th scope="col" className={`${COLUMN_HEADING} max-sm:hidden`}>
                  Last retrieved
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((stat) => (
                <tr key={stat.discussionId}>
                  <td className={`${CELL} wrap-anywhere`}>
                    <ExternalLink href={stat.url}>
                      {stat.kind === 'comment' ? 'Comment on: ' : ''}
                      {stat.title}
                    </ExternalLink>
                  </td>
                  <td className={`${CELL} tabular-nums`}>{stat.retrievalCount}</td>
                  <td className={`${CELL} whitespace-nowrap max-sm:hidden`}>{formatDateTime(stat.lastRetrievedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  );
}
