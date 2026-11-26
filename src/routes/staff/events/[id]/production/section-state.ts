import { m } from '#lib/paraglide/messages.js';
import type { getStaffEventProduction } from '#lib/remote/events.remote.js';

/**
 * Each console section's state, and each tab's summary of its sections.
 * One module for both, so a tab badge says what the headings under it say.
 */

type Loaded = Awaited<ReturnType<typeof getStaffEventProduction>>;
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

/** Not in stock first: a request nothing answers is work before one that runs short. */
export function stockState(check: Loaded['riderStock']): string {
	if (check.unmatchedCount > 0)
		return m.staff_production_state_not_stocked_label({ count: check.unmatchedCount });
	if (check.shortCount > 0)
		return m.staff_production_state_short_label({ count: check.shortCount });
	return check.lines.length > 0
		? m.staff_production_state_in_stock_label()
		: m.staff_production_state_none_asked_label();
}

export function runningOrderState(ros: RunOfShow): string {
	if (!ros.firstSetAt) return m.staff_production_state_no_first_set_label();
	if (ros.slots.length === 0) return m.staff_production_state_no_sets_label();
	if (ros.unslotted.length > 0)
		return m.staff_production_state_bands_unplaced_label({ count: ros.unslotted.length });
	return m.staff_production_state_sets_label({ count: ros.slots.length });
}
