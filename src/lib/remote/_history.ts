import { z } from 'zod';
import { FEED_MAX } from '$lib/types/activity';

/** A record's History card: which record, and how long a page "Show older" has asked for. */
export const historyArgs = z.object({
	id: z.string().min(1),
	limit: z.number().int().min(1).max(FEED_MAX).optional()
});
