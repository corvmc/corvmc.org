import type { DomainEvents } from '$lib/server/event-bus/event-bus';

/** One thing to remind somebody about, and what to say. */
export interface ReminderDue<K extends keyof DomainEvents> {
	/** Stamped against the definition's key, so it is asked once and once only. */
	subjectId: string;
	payload: DomainEvents[K];
}

/**
 * A reminder, as a query plus an event.
 *
 * `due()` describes what is owed *now*, from rows that already exist — never
 * from a stored future time. Firing once is the drain's job, not the
 * window's, so a definition may return the same subject on every pass.
 */
export interface ReminderDefinition<K extends keyof DomainEvents = keyof DomainEvents> {
	key: string;
	subjectType: string;
	event: K;
	due(now: Date): Promise<ReminderDue<K>[]>;
}

/** Widens a definition so differently-keyed ones share one array. */
export function defineReminder<K extends keyof DomainEvents>(
	d: ReminderDefinition<K>
): ReminderDefinition {
	return d as ReminderDefinition;
}
