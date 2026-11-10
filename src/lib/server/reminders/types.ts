import type { DomainEvents } from '#lib/server/event-bus/event-bus.js';

/** One thing to remind somebody about, and what to say. */
export interface ReminderDue<K extends keyof DomainEvents> {
	/** Stamped against the definition's key, so it is asked once and once only. */
	subjectId: string;
	payload: DomainEvents[K];
}

export interface ReminderRecipient {
	userId: string;
	userName: string;
	userEmail: string;
}

/** The item a digest event lists, read off that event's own `items`. */
type DigestItem<K extends keyof DomainEvents> = DomainEvents[K] extends {
	recipient: ReminderRecipient;
	items: (infer T)[];
}
	? T
	: never;

/** One subject owed to several people, folded into each one's digest. */
export interface DigestDue<K extends keyof DomainEvents> {
	subjectId: string;
	recipients: ReminderRecipient[];
	item: DigestItem<K>;
}

interface Common<K extends keyof DomainEvents> {
	key: string;
	subjectType: string;
	event: K;
}

/**
 * A reminder, as a query plus an event.
 *
 * `due()` describes what is owed *now*, from rows that already exist — never
 * from a stored future time. Firing once is the drain's job, not the
 * window's, so a definition may return the same subject on every pass.
 */
export interface PerSubjectDefinition<K extends keyof DomainEvents> extends Common<K> {
	digest?: false;
	due(now: Date): Promise<ReminderDue<K>[]>;
}

/**
 * Every definition sharing a digest's event is folded into one emit per
 * recipient per pass, `{ recipient, items }`. The stamp stays per subject.
 */
export interface DigestDefinition<K extends keyof DomainEvents> extends Common<K> {
	digest: true;
	due(now: Date): Promise<DigestDue<K>[]>;
}

export type ReminderDefinition<K extends keyof DomainEvents = keyof DomainEvents> =
	PerSubjectDefinition<K> | DigestDefinition<K>;

/** Widens a definition so differently-keyed ones share one array. */
export function defineReminder<K extends keyof DomainEvents>(
	d: ReminderDefinition<K>
): ReminderDefinition {
	return d as unknown as ReminderDefinition;
}
