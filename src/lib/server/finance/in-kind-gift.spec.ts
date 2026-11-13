import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * An in-kind gift from an organization or person (#2727), through the real
 * writer into a real ledger, and onto that party's timeline.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: () => ({ id: 'staff-1' })
}));

const { recordInKindGift, InKindGiftValidationError } = await import('./in-kind-gift');
const { reverseEntriesForSubject } = await import('./financial-entry-service');
const { partyTimeline } = await import('#lib/server/party/timeline.js');
const { clubInstant } = await import('#lib/utils/format.js');

const PRINTER = { type: 'organization', id: 'org-print' } as const;
const PERSON = { type: 'contact', id: 'c-1' } as const;

type Row = {
	amount_cents: number;
	kind: string;
	category: string;
	occurred_at: number;
	project_id: string | null;
	subject_type: string;
	subject_id: string;
	recorded_by_user_id: string | null;
};
const entries = () =>
	sqlite.prepare(`select * from financial_entry order by created_at, rowid`).all() as Row[];

beforeEach(() => {
	sqlite.exec(`
		delete from financial_entry; delete from activity; delete from project;
		delete from contact; delete from organization; delete from user;
		insert into user (id, name, email) values ('staff-1', 'Nia Okafor', 'nia@example.test');
		insert into organization (id, name) values ('org-print', 'Print Shop'), ('org-other', 'Other');
		insert into contact (id, name, source) values ('c-1', 'Priya', 'staff_entered');
		insert into project (id, name, kind, status) values ('proj-fest', 'Fall fest', 'event', 'in_progress');
	`);
});

describe('recordInKindGift', () => {
	it('writes one in_kind entry with its value, day, project and giver', async () => {
		await recordInKindGift(
			PRINTER,
			{
				description: 'Posters',
				valueCents: 12000,
				occurredOn: '2026-10-03',
				projectId: 'proj-fest'
			},
			'staff-1'
		);
		const rows = entries();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			amount_cents: 12000,
			kind: 'in_kind',
			category: 'donation',
			occurred_at: Math.floor(clubInstant('2026-10-03', '12:00').getTime() / 1000),
			project_id: 'proj-fest',
			subject_type: 'organization',
			subject_id: 'org-print',
			recorded_by_user_id: 'staff-1'
		});
	});

	it('refuses no value, no description, or a project that does not exist', async () => {
		const ok = { description: 'Food', valueCents: 500, occurredOn: '2026-10-03' };
		for (const bad of [
			{ ...ok, valueCents: 0 },
			{ ...ok, description: '  ' },
			{ ...ok, projectId: 'proj-gone' }
		]) {
			await expect(recordInKindGift(PERSON, bad, 'staff-1')).rejects.toBeInstanceOf(
				InKindGiftValidationError
			);
		}
		expect(entries()).toHaveLength(0);
	});

	it('reverses one gift without touching the giver’s others', async () => {
		const first = await recordInKindGift(
			PERSON,
			{ description: 'Food', valueCents: 500, occurredOn: '2026-10-03' },
			'staff-1'
		);
		await recordInKindGift(
			PERSON,
			{ description: 'Water', valueCents: 300, occurredOn: '2026-10-04' },
			'staff-1'
		);
		await reverseEntriesForSubject('contact', 'c-1', new Date(), {
			metadata: { giftId: first.giftId }
		});
		expect(entries().reduce((t, r) => t + r.amount_cents, 0)).toBe(300);
	});
});

describe('the giver’s timeline', () => {
	it('shows the gift on its giver and on no one else', async () => {
		await recordInKindGift(
			PRINTER,
			{ description: 'Posters', valueCents: 12000, occurredOn: '2026-10-03' },
			'staff-1'
		);
		const mine = await partyTimeline(PRINTER);
		const gift = mine.items.find((i) => i.source === 'gift');
		expect(gift).toMatchObject({ amountCents: 12000, actorName: 'Nia Okafor' });
		expect(gift?.at).toEqual(clubInstant('2026-10-03', '12:00'));

		const other = await partyTimeline({ type: 'organization', id: 'org-other' });
		expect(other.items.some((i) => i.source === 'gift')).toBe(false);
		const person = await partyTimeline(PERSON);
		expect(person.items.some((i) => i.source === 'gift')).toBe(false);
	});
});
