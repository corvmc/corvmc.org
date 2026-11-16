import { resolve } from '$app/paths';
import { formatCents } from '#lib/utils/format.js';
import type { BandSetupStep, BandTodo, BandUpcomingItem } from '#lib/types/band-dashboard.js';

/**
 * What the band dashboard shows, as pure functions over rows its one query has
 * already read (#3128). The page leads with what the band owes or has to
 * answer, then what is coming up, then setup.
 */

export interface TodoInput {
	slug: string;
	/** Upcoming reservations the band still owes money on. */
	unpaid: { id: string; startsAt: Date; cashDueCents: number | null }[];
	/** Owner and admin only; zero for anyone else. */
	unreadEnquiries: number;
	/** Who has not answered an invite yet, by name or email. Owner and admin only. */
	invitees: string[];
	/** Upcoming events the band owns that are still drafts. Owner and admin only. */
	drafts: { id: string; title: string; startsAt: Date }[];
}

/** Dated rows first, soonest wins; then the undated ones in the order built. */
export function bandTodos(input: TodoInput): BandTodo[] {
	const { slug } = input;
	const items: BandTodo[] = [];

	for (const r of input.unpaid) {
		items.push({
			id: `reservation-unpaid:${r.id}`,
			kind: 'reservation-unpaid',
			title: 'Unpaid reservation',
			detail: r.cashDueCents ? `${formatCents(r.cashDueCents)} owed` : 'Balance owed',
			href: resolve('/member/reservations/[id]/pay', { id: r.id }),
			label: 'Pay',
			dueAt: r.startsAt
		});
	}

	for (const e of input.drafts) {
		items.push({
			id: `event-draft:${e.id}`,
			kind: 'event-draft',
			title: e.title,
			detail: 'Draft, not on the calendar',
			href: resolve('/band/[slug]/events/[eventId]', { slug, eventId: e.id }),
			label: 'Edit event',
			dueAt: e.startsAt
		});
	}

	if (input.unreadEnquiries > 0) {
		const n = input.unreadEnquiries;
		items.push({
			id: 'enquiries-unread',
			kind: 'enquiries-unread',
			title: n === 1 ? 'Unread enquiry' : `${n} unread enquiries`,
			detail: 'From the booking form',
			href: resolve('/band/[slug]/messages', { slug }),
			label: 'Read',
			dueAt: null
		});
	}

	if (input.invitees.length > 0) {
		const n = input.invitees.length;
		items.push({
			id: 'invites-pending',
			kind: 'invites-pending',
			title: n === 1 ? 'Unanswered invite' : `${n} unanswered invites`,
			detail: input.invitees.join(', '),
			href: resolve('/band/[slug]/members', { slug }),
			label: 'View invites',
			dueAt: null
		});
	}

	return items.toSorted((a, b) => {
		if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
		if (a.dueAt) return -1;
		if (b.dueAt) return 1;
		return 0;
	});
}

/** Reservations and events in one list, nearest first. */
export function bandUpcoming(
	slug: string,
	reservations: { id: string; startsAt: Date; endsAt: Date; status: string }[],
	events: { id: string; title: string; startsAt: Date; endsAt: Date | null; status: string }[],
	limit: number
): BandUpcomingItem[] {
	const rows: BandUpcomingItem[] = [
		...reservations.map((r) => ({
			id: `reservation:${r.id}`,
			kind: 'reservation' as const,
			title: null,
			startsAt: r.startsAt,
			endsAt: r.endsAt,
			status: r.status,
			href: resolve('/band/[slug]/reservations/[id]', { slug, id: r.id })
		})),
		...events.map((e) => ({
			id: `event:${e.id}`,
			kind: 'event' as const,
			title: e.title,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			status: e.status,
			href: resolve('/band/[slug]/events/[eventId]', { slug, eventId: e.id })
		}))
	];
	return rows.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, limit);
}

export interface SetupInput {
	slug: string;
	memberCount: number;
	invitesPending: number;
	hasReservation: boolean;
	/** The press kit's logo and bio rungs, both done. */
	hasProfile: boolean;
	hasEvent: boolean;
}

/**
 * A new band's first four steps (#3134). Inviting counts as done once someone
 * has been asked: the answer is theirs, and it shows under the band's to-dos.
 */
export function bandSetupSteps(input: SetupInput): BandSetupStep[] {
	const { slug } = input;
	return [
		{
			key: 'invite',
			done: input.memberCount > 1 || input.invitesPending > 0,
			href: resolve('/band/[slug]/members', { slug })
		},
		{
			key: 'reserve',
			done: input.hasReservation,
			href: resolve('/band/[slug]/reservations', { slug })
		},
		{ key: 'profile', done: input.hasProfile, href: resolve('/band/[slug]/edit', { slug }) },
		{ key: 'event', done: input.hasEvent, href: resolve('/band/[slug]/events', { slug }) }
	];
}
