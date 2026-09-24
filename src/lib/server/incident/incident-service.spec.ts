import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * The incident log. What is worth pinning is that nothing is edited away: the
 * account is written once, follow-ups append, and reopening keeps the old
 * resolution as a note rather than overwriting it.
 */

let selectResults: unknown[][] = [];
let updateResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let insertValues: Record<string, unknown>[] = [];
let whereArgs: unknown[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue());
			}
			if (prop === 'where') {
				return (arg: unknown) => {
					whereArgs.push(arg);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

const nextSelect = () => (selectResults.length > 0 ? selectResults.shift()! : []);
const nextUpdate = () => (updateResults.length > 0 ? updateResults.shift()! : []);

const dialect = new SQLiteSyncDialect();
const renderWhere = (index: number) => dialect.sqlToQuery(whereArgs[index] as SQL);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(nextSelect)),
		insert: vi.fn(() => ({
			values: (v: Record<string, unknown>) => {
				insertValues.push(v);
				return chain(() => [{ id: 'inc-1', ...v }]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(nextUpdate);
			}
		}))
	}
}));

const {
	recordIncident,
	addIncidentNote,
	resolveIncident,
	reopenIncident,
	getIncident,
	listIncidents,
	IncidentNotFoundError,
	IncidentStateError,
	IncidentValidationError
} = await import('./incident-service');

const staff = { id: 'staff-1', name: 'Pat Staff' };
const yesterday = new Date(Date.now() - 86_400_000);

beforeEach(() => {
	selectResults = [];
	updateResults = [];
	updateValues = [];
	insertValues = [];
	whereArgs = [];
});

describe('recordIncident', () => {
	it('opens it with the reporter named as they were at the time', async () => {
		await recordIncident(
			{
				occurredAt: yesterday,
				category: 'noise_complaint',
				summary: 'Neighbour called about the bass',
				description: 'Call came in at 10:40pm during the last set.'
			},
			staff
		);

		expect(insertValues[0]).toMatchObject({
			category: 'noise_complaint',
			status: 'open',
			reportedByUserId: 'staff-1',
			reportedByName: 'Pat Staff'
		});
	});

	it('refuses a time in the future', async () => {
		await expect(
			recordIncident(
				{
					occurredAt: new Date(Date.now() + 2 * 86_400_000),
					category: 'other',
					summary: 'x',
					description: 'y'
				},
				staff
			)
		).rejects.toThrow(IncidentValidationError);
	});

	it('refuses an empty account', async () => {
		await expect(
			recordIncident(
				{ occurredAt: yesterday, category: 'other', summary: 'x', description: '   ' },
				staff
			)
		).rejects.toThrow(IncidentValidationError);
	});
});

describe('addIncidentNote', () => {
	it('appends under the incident with the author named', async () => {
		selectResults = [[{ id: 'inc-1', status: 'open' }]];

		await addIncidentNote('inc-1', 'Insurer asked for photos', staff);

		expect(insertValues[0]).toMatchObject({
			incidentId: 'inc-1',
			authorUserId: 'staff-1',
			authorName: 'Pat Staff',
			body: 'Insurer asked for photos'
		});
	});

	it('throws for an incident that does not exist', async () => {
		selectResults = [[]];

		await expect(addIncidentNote('nope', 'x', staff)).rejects.toThrow(IncidentNotFoundError);
	});
});

describe('resolveIncident', () => {
	it('closes an open incident with its resolution', async () => {
		updateResults = [[{ id: 'inc-1', status: 'resolved' }]];

		await resolveIncident('inc-1', 'Spoke to the neighbour; moved sub', staff);

		expect(updateValues[0]).toMatchObject({
			status: 'resolved',
			resolution: 'Spoke to the neighbour; moved sub',
			resolvedByUserId: 'staff-1'
		});
		expect(updateValues[0].resolvedAt).toBeInstanceOf(Date);
		expect(renderWhere(0).sql).toContain('"status" = ?');
	});

	it('says so when it was already resolved', async () => {
		updateResults = [[]];
		selectResults = [[{ id: 'inc-1', status: 'resolved' }]];

		await expect(resolveIncident('inc-1', 'again', staff)).rejects.toThrow(IncidentStateError);
	});

	it('requires a resolution', async () => {
		await expect(resolveIncident('inc-1', ' ', staff)).rejects.toThrow(IncidentValidationError);
	});
});

describe('reopenIncident', () => {
	it('keeps the old resolution as a note instead of erasing it', async () => {
		selectResults = [[{ id: 'inc-1', status: 'resolved', resolution: 'Moved the sub' }]];
		updateResults = [[{ id: 'inc-1', status: 'open' }]];

		await reopenIncident('inc-1', staff);

		expect(insertValues[0]).toMatchObject({ incidentId: 'inc-1', authorName: 'Pat Staff' });
		expect(String(insertValues[0].body)).toContain('Moved the sub');
		expect(updateValues[0]).toMatchObject({ status: 'open', resolution: null, resolvedAt: null });
	});

	it('refuses one that is already open', async () => {
		selectResults = [[{ id: 'inc-1', status: 'open' }]];

		await expect(reopenIncident('inc-1', staff)).rejects.toThrow(IncidentStateError);
	});
});

describe('getIncident', () => {
	it('returns the notes oldest first under the incident', async () => {
		selectResults = [
			[{ incident: { id: 'inc-1' }, involvedName: null }],
			[
				{ id: 'n-1', body: 'first' },
				{ id: 'n-2', body: 'second' }
			]
		];

		const result = await getIncident('inc-1');

		expect(result.notes.map((n) => n.id)).toEqual(['n-1', 'n-2']);
	});

	it('throws when there is no such incident', async () => {
		selectResults = [[]];

		await expect(getIncident('nope')).rejects.toThrow(IncidentNotFoundError);
	});
});

describe('listIncidents', () => {
	it('filters by status and category, and searches the account as well as the summary', async () => {
		selectResults = [[], [{ count: 0 }]];

		await listIncidents(
			{ status: 'open', category: 'injury', search: 'stairs' },
			{ page: 1, pageSize: 25 }
		);

		const { sql, params } = renderWhere(0);
		expect(sql).toContain('"incident"."status" = ?');
		expect(sql).toContain('"incident"."category" = ?');
		expect(sql).toContain('"incident"."description" like ?');
		expect(params).toEqual(expect.arrayContaining(['open', 'injury', '%stairs%']));
	});
});
