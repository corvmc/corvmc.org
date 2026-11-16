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
	'classified',
	'resource_tip',
	'flag',
	'appeal',
	'problem',
	'group_application',
	'market_vendor',
	'hour_log',
	'shift_claim',
	'minor_volunteer'
] as const;
export type ReviewKind = (typeof reviewKinds)[number];

export function isReviewKind(value: unknown): value is ReviewKind {
	return reviewKinds.includes(value as ReviewKind);
}

/**
 * `return` is the kind's own word where the record goes back to be edited and
 * resubmitted (#2892, `retiredTerms` in config.ts); `decline` is final.
 */
export type ReviewDecision = 'approve' | 'decline' | 'return';

/**
 * The kinds decided from the feed row (#2623), and how. Each binds to the remote
 * form its own page submits, in `src/routes/staff/review-decisions.ts`, whose
 * type requires a binding for every entry here. A kind that is absent links out.
 */
export const rowDecisions = {
	suggestion_moderation: ['approve', 'decline'],
	suggestion_edit: ['approve', 'decline'],
	listing: ['approve', 'decline'],
	classified: ['approve', 'decline'],
	resource_tip: ['approve', 'return'],
	hour_log: ['approve', 'return'],
	shift_claim: ['approve', 'decline'],
	minor_volunteer: ['approve']
} as const satisfies Partial<Record<ReviewKind, readonly ReviewDecision[]>>;
export type RowDecidedKind = keyof typeof rowDecisions;

export function isRowDecided(kind: ReviewKind): kind is RowDecidedKind {
	return kind in rowDecisions;
}

/** One row waiting on staff. `at` is when it started waiting; `ref` is where it is decided. */
export interface ReviewItem extends FeedItem {
	kind: ReviewKind;
	/** The waiting record itself: the edit, the signup, the hours. */
	subjectId: string;
	ref: EntityRef;
}
