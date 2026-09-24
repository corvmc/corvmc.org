import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable proxy that records calls and resolves to `selectResult`, so the
// assertions are about the query built rather than what a stub returns.
let selectResult: unknown[] = [];
let chainCalls: { method: string; args: unknown[] }[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return (...args: unknown[]) => {
				chainCalls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => chainable()),
		update: vi.fn(() => chainable()),
		delete: vi.fn(() => chainable())
	}
}));

const listFor = vi.fn(async () => [] as unknown[]);
vi.mock('$lib/server/media/media-service', () => ({ listFor }));

const putPrivateObject = vi.fn(async (key: string) => key);
vi.mock('$lib/server/private-storage', async (actual) => ({
	...(await actual<object>()),
	putPrivateObject: (key: string) => putPrivateObject(key)
}));

const {
	summarizeRenewals,
	listRenewalsExpiringBetween,
	getRenewal,
	updateRenewal,
	removeRenewalDocument,
	uploadRenewalDocument,
	RenewalNotFoundError,
	RenewalDocumentRejectedError
} = await import('./renewal-service');

const TODAY = '2026-09-24';

const row = (id: string, name: string, expiresOn: string) => ({
	id,
	name,
	kind: 'permit' as const,
	issuer: 'City of Corvallis',
	reference: null,
	expiresOn,
	responsibleUserId: null,
	responsibleName: null,
	notes: null
});

beforeEach(() => {
	selectResult = [];
	chainCalls = [];
	vi.clearAllMocks();
});

describe('summarizeRenewals', () => {
	it('sorts by next expiry, soonest first, and marks a lapsed one overdue', () => {
		const out = summarizeRenewals(
			[
				row('b', 'Liability insurance', '2027-03-01'),
				row('a', 'OLCC temporary sales license', '2026-09-01'),
				row('c', 'Sound permit', '2026-10-15')
			],
			TODAY
		);
		expect(out.map((r) => r.id)).toEqual(['a', 'c', 'b']);
		expect(out[0].deadline).toEqual({ kind: 'permit', on: '2026-09-01', overdue: true });
		expect(out[1].deadline.overdue).toBe(false);
		expect(out.map((r) => r.daysLeft)).toEqual([-23, 21, 158]);
	});

	it('does not call the expiry day itself overdue', () => {
		const [r] = summarizeRenewals([row('a', 'Permit', TODAY)], TODAY);
		expect(r.deadline.overdue).toBe(false);
	});

	it('breaks a tie on the date by name', () => {
		const out = summarizeRenewals(
			[row('z', 'Zoning', '2026-12-01'), row('a', 'Assembly', '2026-12-01')],
			TODAY
		);
		expect(out.map((r) => r.id)).toEqual(['a', 'z']);
	});
});

describe('listRenewalsExpiringBetween', () => {
	it('returns each renewal in the range with who is responsible for it', async () => {
		selectResult = [
			{
				...row('r1', 'Liability insurance', '2026-10-10'),
				kind: 'insurance',
				responsibleUserId: 'u1',
				responsibleName: 'Ada',
				responsibleEmail: 'ada@example.com'
			}
		];
		const items = await listRenewalsExpiringBetween('2026-09-24', '2026-11-23');
		expect(items).toEqual([
			expect.objectContaining({
				id: 'r1',
				kind: 'insurance',
				expiresOn: '2026-10-10',
				responsibleUserId: 'u1',
				responsibleEmail: 'ada@example.com'
			})
		]);
		expect(chainCalls.some((c) => c.method === 'where')).toBe(true);
	});
});

describe('getRenewal', () => {
	it('throws not-found for a missing row', async () => {
		selectResult = [];
		await expect(getRenewal('missing', TODAY)).rejects.toBeInstanceOf(RenewalNotFoundError);
	});

	it('links each document through the read route, never by its key', async () => {
		selectResult = [row('r1', 'Permit', '2026-12-01')];
		listFor.mockResolvedValueOnce([
			{ attachmentId: 'att-1', key: 'renewals/r1/x.pdf', filename: 'cert.pdf' }
		]);
		const r = await getRenewal('r1', TODAY);
		expect(listFor).toHaveBeenCalledWith('renewal', 'r1', 'certificate');
		expect(r.documents).toEqual([
			{ attachmentId: 'att-1', filename: 'cert.pdf', url: '/api/renewals/documents/att-1' }
		]);
		expect(JSON.stringify(r.documents)).not.toContain('renewals/r1/x.pdf');
	});
});

describe('updateRenewal', () => {
	it('throws not-found when nothing was updated', async () => {
		selectResult = [];
		await expect(
			updateRenewal('missing', {
				name: 'x',
				kind: 'other',
				issuer: null,
				reference: null,
				expiresOn: '2027-01-01',
				responsibleUserId: null,
				notes: null
			})
		).rejects.toBeInstanceOf(RenewalNotFoundError);
	});
});

describe('removeRenewalDocument', () => {
	it("refuses an attachment that is not this renewal's", async () => {
		selectResult = [];
		await expect(removeRenewalDocument('r1', 'att-other')).rejects.toBeInstanceOf(
			RenewalNotFoundError
		);
	});
});

describe('uploadRenewalDocument', () => {
	const pdf = () => new File(['%PDF-1.4'], 'certificate.pdf', { type: 'application/pdf' });

	it('refuses a type that is not a document or a photo, before writing', async () => {
		const exe = new File(['MZ'], 'x.exe', { type: 'application/x-msdownload' });
		await expect(
			uploadRenewalDocument({ renewalId: 'r1', file: exe, uploadedByUserId: 'u1' })
		).rejects.toBeInstanceOf(RenewalDocumentRejectedError);
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('writes nothing for a renewal that is gone', async () => {
		selectResult = [];
		await expect(
			uploadRenewalDocument({ renewalId: 'r1', file: pdf(), uploadedByUserId: 'u1' })
		).rejects.toBeInstanceOf(RenewalNotFoundError);
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('writes to the private bucket under the renewal', async () => {
		selectResult = [{ id: 'r1' }];
		await uploadRenewalDocument({ renewalId: 'r1', file: pdf(), uploadedByUserId: 'u1' });
		expect(putPrivateObject.mock.calls[0][0]).toMatch(/^renewals\/r1\/[0-9a-f-]+\.pdf$/);
	});
});
