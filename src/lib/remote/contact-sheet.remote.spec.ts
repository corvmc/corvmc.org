import { describe, it, expect, vi, beforeEach } from 'vitest';

// `/act/{token}` has no session: the token is the whole authorization. So the
// entry every read is keyed on must come from the resolved token, and a token
// that does not resolve must reach no read at all.

class ContactSheetLinkInvalidError extends Error {
	status = 404;
}

const sheets = new Map([
	['tok-a', { entryId: 'act-a', name: 'Act A', bio: null, hometown: null, links: null }]
]);

const getContactSheetDisclosure = vi.fn(async (token: string) => {
	const sheet = sheets.get(token);
	if (!sheet) throw new ContactSheetLinkInvalidError();
	return sheet;
});
const issueContactSheetLink = vi.fn(async (..._a: unknown[]) => ({
	token: 'tok-new',
	url: 'https://corvmc.org/act/tok-new',
	outboxId: 'ob-1'
}));
vi.mock('#lib/server/directory/contact-sheet-service.js', () => ({
	getContactSheetDisclosure,
	issueContactSheetLink,
	saveContactSheet: vi.fn()
}));

const deliverNow = vi.fn(async (id: string) => ({ id, status: 'sent', error: null }));
vi.mock('#lib/server/outbox/outbox-service.js', () => ({ deliverNow }));

const listActSlotTerms = vi.fn(async (_entryId: string) => [
	{ eventId: 'e1', contactId: 'c-a', terms: {} },
	{ eventId: 'e2', contactId: null, terms: {} }
]);
vi.mock('#lib/server/production/run-of-show-service.js', () => ({ listActSlotTerms }));

const actContactNamesUnguarded = vi.fn(
	async (_entryId: string, _ids: string[]) => new Map([['c-a', 'Tour manager']])
);
vi.mock('#lib/server/directory/contact-service.js', () => ({ actContactNamesUnguarded }));

const livePosterRequests = vi.fn(async (_entryId: string) => []);
vi.mock('#lib/server/production/artifact-request-service.js', () => ({ livePosterRequests }));
const listFor = vi.fn(async () => []);
vi.mock('#lib/server/media/media-service.js', () => ({ listFor }));
vi.mock('#lib/server/storage.js', () => ({ resolveImageUrl: () => null }));
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' }))
}));
vi.mock('#lib/server/errors.js', () => ({
	mapDomainError: (err: unknown) => {
		throw err;
	}
}));

const remoteFn = (type: string) => (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
	const fn = (...a: unknown[]) => handler(...a);
	(fn as unknown as Record<string, unknown>).__ = { type };
	return fn;
};
vi.mock('$app/server', () => ({
	query: remoteFn('query'),
	form: remoteFn('form'),
	getRequestEvent: () => ({ locals: {}, params: {} })
}));
vi.mock('./_remote', () => ({ form: remoteFn('form') }));

const { getContactSheet, sendContactSheetLink } =
	(await import('./contact-sheet.remote')) as unknown as {
		getContactSheet: (token: string) => Promise<{ bookings: { eventId: string }[] }>;
		sendContactSheetLink: (d: { entryId: string; email: string }) => Promise<unknown>;
	};

beforeEach(() => vi.clearAllMocks());

describe('getContactSheet bookings', () => {
	it('reads slots and contacts for the entry the token resolves to', async () => {
		const sheet = await getContactSheet('tok-a');

		expect(listActSlotTerms).toHaveBeenCalledWith('act-a');
		expect(actContactNamesUnguarded).toHaveBeenCalledWith('act-a', ['c-a']);
		expect(sheet.bookings).toEqual([
			{ eventId: 'e1', terms: {}, contactName: 'Tour manager' },
			{ eventId: 'e2', terms: {}, contactName: null }
		]);
	});

	it.each(['unknown', 'expired-or-revoked'])('reads nothing for a %s token', async (token) => {
		await expect(getContactSheet(token)).rejects.toBeInstanceOf(ContactSheetLinkInvalidError);

		expect(listActSlotTerms).not.toHaveBeenCalled();
		expect(actContactNamesUnguarded).not.toHaveBeenCalled();
		expect(livePosterRequests).not.toHaveBeenCalled();
	});
});

// #2781: "Link sent" answered with nothing sent. The answer is now the outbox
// row's, and the URL comes back so staff can pass it on themselves.
describe('sending a contact sheet link', () => {
	it.each([
		['sent', true],
		['pending', false]
	] as const)('reports the email as sent only when its row is %s', async (status, sent) => {
		deliverNow.mockResolvedValueOnce({ id: 'ob-1', status, error: null });
		const result = await sendContactSheetLink({ entryId: 'act-a', email: 'a@b.test' });

		expect(deliverNow).toHaveBeenCalledWith('ob-1');
		expect(result).toEqual({ success: true, url: 'https://corvmc.org/act/tok-new', sent });
	});
});
