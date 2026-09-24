/**
 * How a sponsored placement is disclosed (#583): the event page and the blasts
 * about a show say the same words, so a sponsor reads as a sponsor everywhere.
 */
export const SPONSOR_CREDIT_LEAD = 'Sponsored by';

type Credited = { name: string; website: string | null };

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
	if (names.length <= 1) return names[0] ?? '';
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const MARKDOWN_SPECIAL = /[\\`*_[\]()#+!|<>~]/g;

function escapeMarkdown(text: string): string {
	return text.replace(MARKDOWN_SPECIAL, (c) => `\\${c}`);
}

function isWebUrl(url: string | null): url is string {
	return url != null && /^https?:\/\/[^\s()]+$/i.test(url);
}

/** One italic line naming every sponsor, linked where they have a website. */
export function sponsorCreditMarkdown(credits: Credited[]): string {
	if (credits.length === 0) return '';
	const names = credits.map((c) =>
		isWebUrl(c.website) ? `[${escapeMarkdown(c.name)}](${c.website})` : escapeMarkdown(c.name)
	);
	return `*${SPONSOR_CREDIT_LEAD} ${joinNames(names)}.*`;
}

/** A campaign body with the credit below everything staff wrote. */
export function withSponsorCredit(markdown: string, credits: Credited[]): string {
	const line = sponsorCreditMarkdown(credits);
	return line ? `${markdown.trimEnd()}\n\n---\n\n${line}\n` : markdown;
}
