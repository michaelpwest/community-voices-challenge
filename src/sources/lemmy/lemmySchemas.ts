import { z } from 'zod';

// Only the fields this app reads from Lemmy's v3 API (checked against 0.19).
// Unknown fields are ignored, so additions on Lemmy's side do not break parsing.

const creatorSchema = z.object({
  name: z.string(),
  actor_id: z.string(),
  bot_account: z.boolean().default(false),
});

export const postViewSchema = z.object({
  post: z.object({
    id: z.number().int(),
    name: z.string(),
    body: z.string().optional(),
    url: z.string().optional(),
    published: z.string(),
    deleted: z.boolean().default(false),
    removed: z.boolean().default(false),
    featured_community: z.boolean().default(false),
    featured_local: z.boolean().default(false),
  }),
  creator: creatorSchema,
  counts: z.object({ score: z.number().int(), comments: z.number().int() }),
});

export const postListSchema = z.object({
  posts: z.array(postViewSchema),
  next_page: z.string().optional(),
});

export const commentViewSchema = z.object({
  comment: z.object({
    id: z.number().int(),
    content: z.string(),
    published: z.string(),
    deleted: z.boolean().default(false),
    removed: z.boolean().default(false),
  }),
  creator: creatorSchema,
  counts: z.object({ score: z.number().int() }),
});

export const commentListSchema = z.object({ comments: z.array(commentViewSchema) });

export type LemmyPostView = z.infer<typeof postViewSchema>;
export type LemmyPostList = z.infer<typeof postListSchema>;
export type LemmyCommentView = z.infer<typeof commentViewSchema>;
