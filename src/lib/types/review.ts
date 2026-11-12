import type { EntityRef } from './entity';
import type { FeedItem } from './activity';

/**
 * What the staff review feed lists (#2623), in the order a same-second tie
 * keeps. The server registry defines one entry per kind; the dashboard names
 * each with a label keyed by this type.
 */
export const reviewKinds = [
	'suggestion_moderation',
	'suggestion_answer',
	'suggestion_edit',
	'listing',
	'resource_tip',
	'appeal',
	'hour_log',
	'shift_claim'
] as const;
export type ReviewKind = (typeof reviewKinds)[number];

export function isReviewKind(value: unknown): value is ReviewKind {
	return reviewKinds.includes(value as ReviewKind);
}

/** One row waiting on staff. `at` is when it started waiting; `ref` is where it is decided. */
export interface ReviewItem extends FeedItem {
	kind: ReviewKind;
	ref: EntityRef;
}
