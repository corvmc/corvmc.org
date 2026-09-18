import { resolve } from '$app/paths';
import { sortNeedsYou, type NeedsYouItem } from '$lib/types/needs-you';
import { VOLUNTEER_BACKDATE_LIMIT_DAYS } from '$lib/config';
import {
	listUnloggedCompletions,
	listSignupsForUser
} from '$lib/server/volunteer/volunteer-signup-service';
import { listUserLoans } from '$lib/server/inventory/loan-service';
import { countPendingRequests } from '$lib/server/inbox/direct-service';
import { getMemberSubscription } from '$lib/server/finance/subscription-service';

/**
 * What the member has to do something about, and when it stops being possible.
 *
 * The dashboard's job is to answer one question — what needs me — and it
 * answered it by region: an alert here, a warning buried in a card there, three
 * nav shortcuts on top (#1245). Ordering was markup, so somebody with three
 * problems saw the same layout as somebody with none.
 */

/** A reservation the room is released from if nobody confirms. */
interface UnconfirmedReservation {
	id: string;
	startsAt: Date;
	bandName: string | null;
}

export interface NeedsYouInput {
	userId: string;
	/** Already fetched by the dashboard query; passed in rather than re-read. */
	unconfirmed: UnconfirmedReservation[];
	pendingInviteCount: number;
	profileComplete: boolean;
	now?: Date;
}

/**
 * One call per source, all in parallel. Each is a read the member's own pages
 * already make, so nothing here is a new access path — only a new place to see
 * it before the page it lives on.
 */
export async function listNeedsYou(input: NeedsYouInput): Promise<NeedsYouItem[]> {
	const now = input.now ?? new Date();

	const [unlogged, signups, loans, messageRequests, subscription] = await Promise.all([
		listUnloggedCompletions(input.userId).catch(() => []),
		listSignupsForUser(input.userId, { limit: 20 }).catch(() => []),
		listUserLoans(input.userId, ['checked_out']).catch(() => ({ rows: [] })),
		countPendingRequests(input.userId).catch(() => 0),
		getMemberSubscription(input.userId).catch(() => null)
	]);

	const items: NeedsYouItem[] = [];

	for (const r of input.unconfirmed) {
		items.push({
			id: `reservation-unconfirmed:${r.id}`,
			kind: 'reservation-unconfirmed',
			title: 'Confirm your practice room booking',
			detail: r.bandName
				? `${r.bandName} — the room is released if nobody confirms`
				: 'The room is released if nobody confirms',
			href: resolve('/member/reservations'),
			label: 'Confirm',
			dueAt: r.startsAt,
			rank: 0
		});
	}

	for (const s of signups) {
		// `startsAt` is nullable: a work order can exist before it is scheduled.
		// An unscheduled shift has no clock, so it is not a deadline.
		if (s.shiftCancelledAt || !s.startsAt) continue;
		if (s.startsAt <= now) continue;
		if (s.status !== 'claimed' && s.status !== 'confirmed') continue;
		items.push({
			id: `volunteer-shift-soon:${s.signupId}`,
			kind: 'volunteer-shift-soon',
			title: `You are on ${s.roleName}`,
			detail: s.eventTitle ?? undefined,
			href: resolve(`/member/volunteer/shifts/${s.signupId}`),
			label: 'Open',
			dueAt: s.startsAt,
			rank: 1
		});
	}

	for (const c of unlogged) {
		if (!c.endsAt) continue;
		// The window closes: hours cannot be backdated past the limit, so this is
		// a deadline even though nothing happens on the day it passes.
		items.push({
			id: `volunteer-hours-unlogged:${c.signupId}`,
			kind: 'volunteer-hours-unlogged',
			title: `Log your hours for ${c.roleName}`,
			href: resolve('/member/volunteer/hours'),
			label: 'Log hours',
			dueAt: new Date(c.endsAt.getTime() + VOLUNTEER_BACKDATE_LIMIT_DAYS * 86_400_000),
			rank: 2
		});
	}

	for (const loan of loans.rows) {
		if (!loan.dueDate) continue;
		items.push({
			id: `loan-due:${loan.id}`,
			kind: 'loan-due',
			title: `Return ${loan.equipmentName ?? 'the gear you borrowed'}`,
			href: resolve('/member/equipment/loans'),
			label: 'See the loan',
			dueAt: loan.dueDate,
			rank: 3
		});
	}

	if (subscription?.cancelAtPeriodEnd && subscription.creditsResetAt) {
		items.push({
			id: 'membership-ending',
			kind: 'membership-ending',
			title: 'Your sustaining membership ends',
			detail: 'Practice hours stop resetting after that date',
			href: resolve('/member/membership'),
			label: 'Membership',
			dueAt: new Date(subscription.creditsResetAt),
			rank: 4
		});
	}

	// Below here: real, but on nobody's clock. They sort after everything dated
	// however long they have been waiting — an invitation with no expiry is not
	// more urgent than a room you lose on Friday.
	if (input.pendingInviteCount > 0) {
		items.push({
			id: 'band-invitation',
			kind: 'band-invitation',
			title:
				input.pendingInviteCount === 1
					? 'An act has invited you'
					: `${input.pendingInviteCount} acts have invited you`,
			href: resolve('/member/bands'),
			label: 'Answer',
			dueAt: null,
			rank: 10
		});
	}

	if (messageRequests > 0) {
		items.push({
			id: 'message-request',
			kind: 'message-request',
			title:
				messageRequests === 1
					? 'Somebody asked to message you'
					: `${messageRequests} people asked to message you`,
			href: resolve('/member/messages'),
			label: 'Read',
			dueAt: null,
			rank: 11
		});
	}

	if (!input.profileComplete) {
		items.push({
			id: 'profile-incomplete',
			kind: 'profile-incomplete',
			title: 'Add your instruments or a short bio',
			detail: 'So other members can find you in the directory',
			href: resolve('/member/profile'),
			label: 'Edit profile',
			dueAt: null,
			rank: 12
		});
	}

	return sortNeedsYou(items);
}
