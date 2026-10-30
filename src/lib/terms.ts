import { m } from '$lib/paraglide/messages.js';
import type { EntityType, GroupKind } from '$lib/config';

/**
 * The interface's nouns, from `messages/en.json`: a relabel is an edit there
 * (docs/development/conventions.md#terminology). Each `term_*` message is
 * lower-case and plural-aware; `one`/`many` give a label's capitalised form.
 */
export type Term = (inputs: { count: number }) => string;

export const one = (term: Term): string => upperFirst(term({ count: 1 }));
export const many = (term: Term): string => upperFirst(term({ count: 2 }));

function upperFirst(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The message behind each entity type. */
export const entityTerms: Record<EntityType, Term> = {
	member: m.term_member,
	band: m.term_band,
	event: m.term_event,
	reservation: m.term_reservation,
	suggestion: m.term_suggestion,
	thread: m.term_thread,
	flag: m.term_flag,
	campaign: m.term_campaign,
	audience: m.term_audience,
	equipment: m.term_equipment,
	asset: m.term_asset,
	loan: m.term_loan,
	shift: m.term_shift,
	role: m.term_role,
	recurring: m.term_recurring,
	help: m.term_help,
	classified: m.term_classified,
	incident: m.term_incident,
	project: m.term_project
};

/**
 * What to call one, and what to call several, as a label.
 *
 * Domain-specific wording at a call site ("Waiting on DNS" rather than
 * "Pending") stays at the call site — the same rule `StatusBadge` follows.
 */
export const entityLabels = Object.fromEntries(
	Object.entries(entityTerms).map(([type, term]) => [type, { one: one(term), many: many(term) }])
) as Record<EntityType, { one: string; many: string }>;

/**
 * A group kind in lower-case prose for someone not looking at it: an invitee
 * has no page open, and "join a band" is not true of the Real Book Club.
 */
export const groupKindLabels: Record<GroupKind, string> = {
	band: m.term_band({ count: 1 }),
	club: m.term_club({ count: 1 }),
	committee: m.term_committee({ count: 1 })
};
