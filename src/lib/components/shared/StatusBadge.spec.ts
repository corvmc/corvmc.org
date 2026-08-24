import { describe, it, expect } from 'vitest';
import { variants, badgeClass, labels } from './StatusBadge.svelte';
import {
	equipmentStatuses,
	loanStatuses,
	inboxThreadStatuses,
	volunteerHourStatuses,
	volunteerProfileStatuses,
	suggestionStatuses,
	suggestionVisibilities
} from '$lib/config';
import { ticketStatuses } from '$lib/server/db/schema/ticket';
import { reservationStatuses } from '$lib/server/db/schema/reservation';
import { eventStatuses } from '$lib/server/db/schema/event';
import { flagStatuses } from '$lib/server/db/schema/flag';
import { bandMemberStatuses, bandTiers } from '$lib/server/db/schema/band';
import { inviteStatuses } from '$lib/server/db/schema/platform-invite';

/**
 * An unmapped status falls back to a neutral dot that says nothing. Before this
 * suite existed the fallback was a red circle-x, so every equipment item marked
 * `available` rendered as an error, as did `checked_in` tickets and `returned`
 * loans. This asserts every status vocabulary in the app is covered — a new
 * enum value fails here rather than shipping a meaningless glyph.
 */

/** Statuses that aren't a schema enum: derived, or literals passed at call sites. */
const derivedStatuses = {
	// campaign-service.ts `deriveCampaignStatus`
	campaign: ['draft', 'scheduled', 'sending', 'sent'],
	// Member subtypes / band member roles
	bandRoles: ['owner', 'admin', 'member'],
	// staff/bands/+page.svelte, and the shared ActivateToggleAction pages
	activation: ['active', 'deactivated'],
	// payment-service.ts writes `completed`; refunds write `refunded`
	payment: ['completed', 'refunded'],
	// roles/[id] — whether a member holds what the role requires
	clearance: ['cleared', 'uncleared'],
	// suggestion-service.ts `displayStatus` — derived from mergedIntoId, never stored
	suggestionDerived: ['merged'],
	// components/inbox/thread-status.ts `threadDisplayStatus` — an open thread
	// carrying `awaitingReplySince`, never a stored status value
	inboxDerived: ['awaiting_reply'],

	// member-certification-service.ts `certificationState` — the state of one
	// held clearance, shown on the staff user record and the clearances list
	certificationState: ['current', 'expiring', 'expired', 'revoked'],
	// generic
	generic: ['pending', 'error']
} as const;

const vocabularies: Record<string, readonly string[]> = {
	reservation: reservationStatuses,
	event: eventStatuses,
	flag: flagStatuses,
	bandMember: bandMemberStatuses,
	bandTier: bandTiers,
	platformInvite: inviteStatuses,
	ticket: ticketStatuses,
	equipment: equipmentStatuses,
	equipmentLoan: loanStatuses,
	inboxThread: inboxThreadStatuses,
	volunteerHour: volunteerHourStatuses,
	volunteerProfile: volunteerProfileStatuses,
	suggestion: suggestionStatuses,
	// `visible` is intentionally absent: an on-the-board suggestion shows no badge.
	suggestionVisibility: suggestionVisibilities.filter((v) => v !== 'visible'),
	...derivedStatuses
};

describe('StatusBadge coverage', () => {
	for (const [name, statuses] of Object.entries(vocabularies)) {
		it(`maps every ${name} status to an icon variant`, () => {
			const missing = statuses.filter((s) => !(s in variants));
			expect(missing, `add these to \`variants\` in StatusBadge.svelte`).toEqual([]);
		});

		it(`maps every ${name} status to a badge colour`, () => {
			const missing = statuses.filter((s) => !(s in badgeClass));
			expect(missing, `add these to \`badgeClass\` in StatusBadge.svelte`).toEqual([]);
		});
	}

	it('keeps the two maps in agreement', () => {
		expect(Object.keys(variants).sort()).toEqual(Object.keys(badgeClass).sort());
	});

	/**
	 * A label override for a status that no longer exists is invisible — it just
	 * never fires — so the wrong word silently outlives the rename that caused it.
	 */
	it('has no display label for a status that no longer exists', () => {
		const known = new Set(Object.values(vocabularies).flat());
		const stale = Object.keys(labels).filter((s) => !known.has(s));
		expect(stale, 'these are not in any status vocabulary').toEqual([]);
	});
});
