import type { ResolvedPathname } from '$app/types';

/**
 * The band dashboard's rows (#3128). Here rather than beside the builder because
 * the page renders them, and a component must not import from `$lib/server`.
 */

/** Something the band owes or has to answer, with the action on the row. */
export interface BandTodo {
	/** Unique in the list, and the `{#each}` key. */
	id: string;
	kind: 'reservation-unpaid' | 'enquiries-unread' | 'invites-pending' | 'event-draft';
	title: string;
	detail?: string;
	href: ResolvedPathname;
	label: string;
	/** When this stops being actionable; `null` sorts after everything dated. */
	dueAt: Date | null;
}

/** One reservation or event in the date-ordered Upcoming list. */
export interface BandUpcomingItem {
	id: string;
	kind: 'reservation' | 'event';
	/** An event's title; a reservation has none and the page names it. */
	title: string | null;
	startsAt: Date;
	endsAt: Date | null;
	status: string;
	href: ResolvedPathname;
}

export type BandSetupKey = 'invite' | 'reserve' | 'profile' | 'event';

/** A first-week step, ticked once done (#3134). */
export interface BandSetupStep {
	key: BandSetupKey;
	done: boolean;
	href: ResolvedPathname;
}
