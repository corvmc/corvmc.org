import { m } from '#lib/paraglide/messages.js';
import { formatCents } from '#lib/utils/format.js';

/** Each settings section's state, and each tab's summary of its sections. */

const filled = (values: unknown[]) => values.filter((v) => String(v ?? '').trim() !== '').length;

/** A section whose fields belong together: none, some or all of them filled. */
export function fieldsState(values: unknown[]): string {
	const n = filled(values);
	if (n === 0) return m.staff_settings_state_not_set_label();
	return n === values.length
		? m.staff_settings_state_set_label()
		: m.staff_settings_state_incomplete_label();
}

/** Optional links, each standing alone. */
export const linksState = (values: unknown[]) =>
	m.staff_settings_state_links_label({ count: filled(values), total: values.length });

export const hourValueState = (cents: number) =>
	m.staff_settings_state_hour_value_label({ amount: formatCents(cents) });

export const switchState = (enabled: boolean) =>
	enabled ? m.staff_settings_state_on_label() : m.staff_settings_state_off_label();

export const onOfState = (flags: boolean[]) =>
	m.staff_settings_state_on_of_label({ on: flags.filter(Boolean).length, total: flags.length });

/** The Organization tab: how many of its required sections are not fully set. */
export function organizationBadge(sections: unknown[][]): string | undefined {
	const count = sections.filter((values) => filled(values) < values.length).length;
	return count > 0 ? m.staff_settings_state_sections_not_set_label({ count }) : undefined;
}
