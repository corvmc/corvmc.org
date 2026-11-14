import { resolve } from '$app/paths';
import type { NeedsYouItem } from '#lib/types/needs-you.js';
import type { MemberSignup } from '#lib/server/volunteer/volunteer-signup-service.js';

export type ShiftNeedingYou = Pick<
	MemberSignup,
	'signupId' | 'roleName' | 'startsAt' | 'endsAt' | 'status' | 'shiftCancelledAt' | 'eventTitle'
>;

/**
 * A shift the member is booked on, from before it starts until it ends (#2803).
 * While it runs it is due at its end, so it sorts first and never reads overdue.
 */
export function shiftNeedsYouItems(rows: ShiftNeedingYou[], now: Date): NeedsYouItem[] {
	const items: NeedsYouItem[] = [];
	for (const s of rows) {
		// `startsAt` is nullable: a work order can exist before it is scheduled.
		// An unscheduled shift has no clock, so it is not a deadline.
		if (s.shiftCancelledAt || !s.startsAt) continue;
		if (s.status !== 'claimed' && s.status !== 'confirmed') continue;
		const end = s.endsAt ?? s.startsAt;
		if (end <= now) continue;
		const onNow = s.startsAt <= now;
		items.push({
			id: `volunteer-shift-soon:${s.signupId}`,
			kind: 'volunteer-shift-soon',
			title: `You are on ${s.roleName}`,
			detail: onNow
				? s.eventTitle
					? `On now · ${s.eventTitle}`
					: 'On now'
				: (s.eventTitle ?? undefined),
			href: resolve(`member/volunteer/shifts/${s.signupId}`),
			label: 'Open',
			dueAt: onNow ? end : s.startsAt,
			rank: 1
		});
	}
	return items;
}
