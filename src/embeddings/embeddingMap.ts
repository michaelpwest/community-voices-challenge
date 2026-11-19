import type { DatabaseSync } from 'node:sqlite';
import type { EmbeddingMap } from '../shared/insights';
import { lastSevenDays } from '../shared/time';
import { listEmbeddings } from '../storage/insightStore';
import { projectToTwoDimensions } from './projection';

export interface EmbeddingMapDependencies {
  db: DatabaseSync;
  community: string;
  embeddingModel: string;
  now?: () => Date;
}

/** Places every embedding from the past seven days on a two-dimensional map. */
export function buildEmbeddingMap(dependencies: EmbeddingMapDependencies): EmbeddingMap {
  const { db, community, embeddingModel, now = () => new Date() } = dependencies;
  const window = lastSevenDays(now());
  const embeddings = listEmbeddings(db, community, embeddingModel, window);
  const projection = projectToTwoDimensions(embeddings.map((embedding) => embedding.vector));
  return {
    embeddingModel,
    method: 'pca',
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    explainedVariance: projection.explainedVariance,
    points: embeddings.map((embedding, index) => {
      const [x, y] = projection.points[index] ?? [0, 0];
      return {
        discussionId: embedding.discussionId,
        kind: embedding.kind,
        title: embedding.title,
        url: embedding.url,
        postedAt: embedding.postedAt,
        x,
        y,
        retrievalCount: embedding.retrievalCount,
      };
    }),
  };
}
