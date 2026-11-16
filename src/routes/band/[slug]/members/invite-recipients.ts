/** One person on the invite list: a member found by search, or a bare address. */
export type Recipient =
	{ kind: 'member'; id: string; name: string; email: string } | { kind: 'email'; email: string };

export type SearchHit = { id: string; name: string; email: string };

export type Outcome = {
	kind: 'member' | 'email';
	recipient: string;
	sent: boolean;
	reason?: string;
};

export function looksLikeEmail(text: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}

/** The value the server reports an outcome against: the user id or the address. */
export function recipientKey(r: Recipient): string {
	return r.kind === 'member' ? r.id : r.email.toLowerCase();
}

/** Appends `next` unless the same person, by id or by address, is already listed. */
export function addRecipient(list: Recipient[], next: Recipient): Recipient[] {
	const email = next.email.toLowerCase();
	const taken = list.some(
		(r) =>
			recipientKey(r) === recipientKey(next) || (email !== '' && r.email.toLowerCase() === email)
	);
	return taken ? list : [...list, next];
}

/**
 * What the typed text stands for, if it can stand for only one person: a member
 * whose address it is, the only search result, or a new address.
 */
export function resolveTyped(text: string, hits: SearchHit[]): Recipient | null {
	const typed = text.trim();
	if (!typed) return null;
	if (looksLikeEmail(typed)) {
		const member = hits.find((h) => h.email.toLowerCase() === typed.toLowerCase());
		return member ? { kind: 'member', ...member } : { kind: 'email', email: typed.toLowerCase() };
	}
	return hits.length === 1 ? { kind: 'member', ...hits[0] } : null;
}

/** The recipients not sent, each with the reason the server gave. */
export function unsent(
	list: Recipient[],
	outcomes: Outcome[]
): { recipient: Recipient; reason?: string }[] {
	const byKey = new Map(outcomes.map((o) => [o.recipient, o]));
	return list.flatMap((recipient) => {
		const outcome = byKey.get(recipientKey(recipient));
		return outcome && !outcome.sent ? [{ recipient, reason: outcome.reason }] : [];
	});
}
