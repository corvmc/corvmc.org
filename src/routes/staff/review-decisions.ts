import type { RemoteForm } from '$app/server';
import {
	approveVolunteerHours,
	approveVolunteerSignup,
	confirmSignup,
	rejectVolunteerHours,
	releaseSignup
} from '#lib/remote/volunteer.remote.js';
import { approveListing, rejectListing } from '#lib/remote/community-events.remote.js';
import { moderateClassified } from '#lib/remote/classifieds.remote.js';
import {
	publishLocalResourceForm,
	rejectLocalResourceForm
} from '#lib/remote/local-resources.remote.js';
import { reviewSuggestion, reviewSuggestionEdit } from '#lib/remote/suggestions.remote.js';
import {
	isRowDecided,
	type ReviewDecision,
	type ReviewItem,
	type rowDecisions
} from '#lib/types/review.js';

/**
 * One decision made from a feed row: the remote form the kind's own page
 * submits, the values it posts for the row, and, when that form refuses a
 * decision without a written reason, the field the reason goes in.
 */
export interface RowDecision {
	// Any remote form: `RemoteForm` is invariant in its input (see `Action`).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	form: RemoteForm<any, any>;
	values: (item: Pick<ReviewItem, 'subjectId' | 'ref'>) => Record<string, string>;
	message?: string;
}

type Bindings = {
	[K in keyof typeof rowDecisions]: {
		[D in (typeof rowDecisions)[K][number]]: RowDecision;
	};
};

const refId = (item: Pick<ReviewItem, 'ref'>) => item.ref.id ?? '';

export const reviewDecisionForms = {
	suggestion_moderation: {
		approve: {
			form: reviewSuggestion,
			values: (i) => ({ suggestionId: refId(i), decision: 'approve' })
		},
		decline: {
			form: reviewSuggestion,
			values: (i) => ({ suggestionId: refId(i), decision: 'reject' })
		}
	},
	suggestion_edit: {
		approve: {
			form: reviewSuggestionEdit,
			values: (i) => ({ suggestionId: refId(i), editId: i.subjectId, decision: 'approve' })
		},
		decline: {
			form: reviewSuggestionEdit,
			values: (i) => ({ suggestionId: refId(i), editId: i.subjectId, decision: 'reject' })
		}
	},
	listing: {
		approve: { form: approveListing, values: (i) => ({ eventId: i.subjectId }) },
		decline: { form: rejectListing, values: (i) => ({ eventId: i.subjectId }), message: 'notes' }
	},
	classified: {
		approve: {
			form: moderateClassified,
			values: (i) => ({ postId: i.subjectId, visibility: 'visible' })
		},
		decline: {
			form: moderateClassified,
			values: (i) => ({ postId: i.subjectId, visibility: 'hidden' }),
			message: 'note'
		}
	},
	resource_tip: {
		approve: { form: publishLocalResourceForm, values: (i) => ({ id: i.subjectId }) },
		return: {
			form: rejectLocalResourceForm,
			values: (i) => ({ id: i.subjectId }),
			message: 'note'
		}
	},
	hour_log: {
		approve: { form: approveVolunteerHours, values: (i) => ({ id: i.subjectId }) },
		return: { form: rejectVolunteerHours, values: (i) => ({ id: i.subjectId }), message: 'notes' }
	},
	shift_claim: {
		approve: {
			form: confirmSignup,
			values: (i) => ({ signupId: i.subjectId, shiftId: refId(i) })
		},
		decline: {
			form: releaseSignup,
			values: (i) => ({ signupId: i.subjectId, shiftId: refId(i) })
		}
	},
	minor_volunteer: {
		approve: { form: approveVolunteerSignup, values: (i) => ({ userId: i.subjectId }) }
	}
} satisfies Bindings;

/** The decisions a row offers, in declaration order; none for a kind that links out. */
export function decisionsFor(item: Pick<ReviewItem, 'kind'>): [ReviewDecision, RowDecision][] {
	if (!isRowDecided(item.kind)) return [];
	const bound: Partial<Record<ReviewDecision, RowDecision>> = reviewDecisionForms[item.kind];
	return Object.entries(bound) as [ReviewDecision, RowDecision][];
}
