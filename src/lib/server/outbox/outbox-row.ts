import type { OutboxKind } from '#lib/server/db/schema/outbox.js';
import type { TemplatedEmail } from '#lib/server/notification/email/postmark-client.js';

/** The record a message belongs to, which its page reads the delivery status from. */
export interface OutboxSubject {
	type: string;
	id: string;
}

export type OutboxPayload =
	| { kind: 'email'; payload: TemplatedEmail }
	| { kind: 'inbox_reply'; payload: { messageId: string } };

/** An outbox row's values, id included, for a caller that inserts it inside its own batch. */
export function outboxRow(message: OutboxPayload, subject?: OutboxSubject) {
	return {
		id: crypto.randomUUID(),
		kind: message.kind as OutboxKind,
		payload: message.payload as unknown as Record<string, unknown>,
		subjectType: subject?.type ?? null,
		subjectId: subject?.id ?? null
	};
}

/** A templated email as an outbox row. */
export const emailRow = (mail: TemplatedEmail, subject?: OutboxSubject) =>
	outboxRow({ kind: 'email', payload: mail }, subject);
