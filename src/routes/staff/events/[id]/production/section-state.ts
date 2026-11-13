import { m } from '#lib/paraglide/messages.js';
import { formatCents } from '#lib/utils/format.js';
import type { getStaffEventProduction } from '#lib/remote/events.remote.js';
import type { TabKey } from './tabs';

/**
 * Each console section's state, and each tab's summary of its sections.
 * One module for both, so a tab badge says what the headings under it say.
 */

type Loaded = Awaited<ReturnType<typeof getStaffEventProduction>>;
type Settlement = NonNullable<Loaded['settlement']>;
type RunOfShow = NonNullable<Loaded['runOfShow']>;

export function deliverablesState(items: Loaded['deliverables']): string | undefined {
	const live = items.filter((i) => i.state !== 'cancelled');
	if (live.length === 0) return undefined;
	const done = live.filter((i) => i.state === 'done').length;
	return m.staff_production_state_done_of_label({ done, total: live.length });
}

function requestsOpen(requests: Loaded['artifactRequests']): string | undefined {
	const outstanding = requests.filter((r) => !r.fulfilled);
	const overdue = outstanding.filter((r) => r.overdue).length;
	if (overdue > 0) return m.staff_production_state_requests_overdue_label({ count: overdue });
	if (outstanding.length > 0)
		return m.staff_production_state_requests_waiting_label({ count: outstanding.length });
	return undefined;
}

export function requestsState(requests: Loaded['artifactRequests']): string {
	return (
		requestsOpen(requests) ??
		(requests.length > 0
			? m.staff_production_state_all_in_label()
			: m.staff_production_state_none_asked_label())
	);
}

export function runningOrderState(ros: RunOfShow): string {
	if (!ros.firstSetAt) return m.staff_production_state_no_first_set_label();
	if (ros.slots.length === 0) return m.staff_production_state_no_sets_label();
	if (ros.unslotted.length > 0)
		return m.staff_production_state_bands_unplaced_label({ count: ros.unslotted.length });
	return m.staff_production_state_sets_label({ count: ros.slots.length });
}

export const nightState = (s: Settlement) =>
	m.staff_production_state_net_label({ amount: formatCents(s.netCents) });

export function doorState(s: Settlement): string {
	if (!s.door) return m.staff_production_state_not_counted_label();
	const amount = formatCents(s.door.cashCents);
	switch (s.doorCounts?.check) {
		case 'mismatch':
			return m.staff_production_state_counts_differ_label();
		case 'agreed':
			return m.staff_production_state_counted_twice_label({ amount });
		case 'single':
			return m.staff_production_state_counted_once_label({ amount });
		default:
			return m.staff_production_state_door_counted_label({ amount });
	}
}

export const costsState = (s: Settlement) =>
	s.expenses.length === 0
		? m.staff_production_state_none_recorded_label()
		: m.staff_production_state_costs_label({ count: s.expenses.length });

export function payoutsState(s: Settlement): string {
	if (s.acts.length === 0) return m.staff_production_state_no_bands_label();
	if (s.unpaidActCount > 0)
		return m.staff_production_state_paid_of_label({
			paid: s.acts.length - s.unpaidActCount,
			total: s.acts.length
		});
	return m.staff_production_state_settled_label();
}

function advanceBadge(loaded: Loaded): string | undefined {
	const open = requestsOpen(loaded.artifactRequests);
	if (open) return open;
	const missing = loaded.riders.filter((r) => r.empty).length;
	if (missing > 0) return m.staff_production_state_riders_missing_label({ count: missing });
	if (loaded.artifactRequests.length > 0 || loaded.riders.length > 0)
		return m.staff_production_state_all_in_label();
	return undefined;
}

function settlementBadge(s: Settlement | null): string | undefined {
	if (!s) return undefined;
	if (s.unpaidActCount > 0)
		return m.staff_production_state_bands_unpaid_label({ count: s.unpaidActCount });
	if (!s.door) return m.staff_production_state_not_counted_label();
	if (s.doorCounts?.check === 'mismatch') return m.staff_production_state_counts_differ_label();
	if (s.doorCounts?.check === 'single') return m.staff_production_state_one_count_label();
	return s.acts.length > 0 ? m.staff_production_state_settled_label() : undefined;
}

/** What a closed tab's headings say, worst first. Undefined when there is nothing to say. */
export function tabBadges(loaded: Loaded): Record<TabKey, string | undefined> {
	return {
		overview: loaded.production
			? deliverablesState(loaded.deliverables)
			: m.staff_production_state_not_opened_label(),
		advance: advanceBadge(loaded),
		runOfShow: loaded.runOfShow ? runningOrderState(loaded.runOfShow) : undefined,
		settlement: settlementBadge(loaded.settlement)
	};
}
