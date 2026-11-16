/** Distinct addresses in order, case-insensitively, skipping blanks. */
export function uniqueEmails(emails: Iterable<string | null | undefined>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const email of emails) {
		const trimmed = email?.trim();
		const key = trimmed?.toLowerCase();
		if (!trimmed || !key || seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}
