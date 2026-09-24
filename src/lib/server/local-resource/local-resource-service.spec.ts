import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * The local resources directory. What is worth pinning: the public read filters
 * in the query, staff-authored listings publish on save, `rejected` carries its
 * reason, and a category in use cannot be deleted.
 */

let selectResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let insertValues: Record<string, unknown>[] = [];
let deleteCalls = 0;
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
const dialect = new SQLiteSyncDialect();
const renderWhere = (index: number) => dialect.sqlToQuery(whereArgs[index] as SQL);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(nextSelect)),
		insert: vi.fn(() => ({
			values: (v: Record<string, unknown>) => {
				insertValues.push(v);
				return chain(() => [{ id: 'lr-1', ...v }]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(() => [{ id: 'lr-1', ...values }]);
			}
		})),
		delete: vi.fn(() => {
			deleteCalls++;
			return chain(() => []);
		})
	}
}));

const emit = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('$lib/server/event-bus', () => ({ domainEvents: { emit } }));

const svc = await import('./local-resource-service');

beforeEach(() => {
	selectResults = [];
	updateValues = [];
	insertValues = [];
	deleteCalls = 0;
	whereArgs = [];
	emit.mockClear();
});

describe('submitTip (#1498)', () => {
	const tip = { categoryId: 'c-1', name: 'Amp Doctor', website: 'ampdoctor.example' };

	it('files a public tip as a pending listing with the submitter email', async () => {
		selectResults = [[{ id: 'c-1' }]];

		await svc.submitTip(tip, { submitterEmail: ' Tipper@Example.com ' });

		expect(insertValues[0]).toMatchObject({
			name: 'Amp Doctor',
			website: 'https://ampdoctor.example/',
			status: 'pending',
			submitterEmail: 'tipper@example.com',
			submittedByUserId: null
		});
		expect(insertValues[0].reviewedAt).toBeUndefined();
		expect(emit).toHaveBeenCalledWith('local_resource.submitted', {
			resourceId: 'lr-1',
			name: 'Amp Doctor'
		});
	});

	it('refuses a category that does not exist', async () => {
		selectResults = [[]];
		await expect(svc.submitTip(tip, { submitterEmail: 'a@b.example' })).rejects.toThrow(
			svc.LocalResourceValidationError
		);
		expect(insertValues).toHaveLength(0);
	});
});

describe('telling the submitter the outcome (#1498)', () => {
	it('announces a publish to a tip that left an email', async () => {
		selectResults = [
			[{ id: 'lr-1', status: 'pending', name: 'Amp Doctor', submitterEmail: 't@x.example' }]
		];

		await svc.publishResource('lr-1', 'staff-1');

		expect(emit).toHaveBeenCalledWith('local_resource.reviewed', {
			resourceId: 'lr-1',
			name: 'Amp Doctor',
			submitterEmail: 't@x.example',
			published: true,
			staffNote: null
		});
	});

	it('announces a return with the note', async () => {
		selectResults = [
			[{ id: 'lr-1', status: 'pending', name: 'Amp Doctor', submitterEmail: 't@x.example' }]
		];

		await svc.rejectResource('lr-1', 'Needs a website', 'staff-1');

		expect(emit).toHaveBeenCalledWith(
			'local_resource.reviewed',
			expect.objectContaining({ published: false, staffNote: 'Needs a website' })
		);
	});

	it('stays quiet for a staff-authored listing, and for a re-publish', async () => {
		selectResults = [[{ id: 'lr-1', status: 'pending', name: 'X', submitterEmail: null }]];
		await svc.publishResource('lr-1', 'staff-1');
		selectResults = [
			[{ id: 'lr-1', status: 'published', name: 'X', submitterEmail: 't@x.example' }]
		];
		await svc.publishResource('lr-1', 'staff-1');

		expect(emit).not.toHaveBeenCalled();
	});
});

describe('listPublishedByCategory', () => {
	it('filters to published, undeleted rows in the query itself', async () => {
		selectResults = [[]];

		await svc.listPublishedByCategory();

		const { sql, params } = renderWhere(0);
		expect(sql).toContain('"local_resource"."status" = ?');
		expect(sql).toContain('"local_resource"."deleted_at" is null');
		expect(params).toContain('published');
	});

	it('groups rows under their category, in order, and leaves out empty categories', async () => {
		selectResults = [
			[
				{ categoryId: 'c-1', categoryName: 'Shops', resource: { id: 'a', name: 'Amp Shop' } },
				{ categoryId: 'c-1', categoryName: 'Shops', resource: { id: 'b', name: 'Drum Shop' } },
				{ categoryId: 'c-2', categoryName: 'Venues', resource: { id: 'c', name: 'The Hall' } }
			]
		];

		const groups = await svc.listPublishedByCategory();

		expect(groups.map((g) => g.name)).toEqual(['Shops', 'Venues']);
		expect(groups[0].resources.map((r) => r.id)).toEqual(['a', 'b']);
	});
});

describe('createResource', () => {
	it('publishes a staff-authored listing on save', async () => {
		await svc.createResource({ categoryId: 'c-1', name: 'Amp Shop' }, 'staff-1');

		expect(insertValues[0]).toMatchObject({
			status: 'published',
			reviewedByUserId: 'staff-1',
			name: 'Amp Shop'
		});
	});

	it('refuses a website that is not a web address', async () => {
		await expect(
			svc.createResource({ categoryId: 'c-1', name: 'x', website: 'javascript:alert(1)' }, 's')
		).rejects.toThrow(svc.LocalResourceValidationError);
	});
});

describe('reviewing', () => {
	it('publishes and clears any earlier rejection note', async () => {
		selectResults = [[{ id: 'lr-1', status: 'rejected' }]];

		await svc.publishResource('lr-1', 'staff-1');

		expect(updateValues[0]).toMatchObject({
			status: 'published',
			staffNote: null,
			reviewedByUserId: 'staff-1'
		});
	});

	it('rejects with the reason the submitter will see', async () => {
		selectResults = [[{ id: 'lr-1', status: 'pending' }]];

		await svc.rejectResource('lr-1', 'Needs a website', 'staff-1');

		expect(updateValues[0]).toMatchObject({ status: 'rejected', staffNote: 'Needs a website' });
	});

	it('will not reject without a reason', async () => {
		await expect(svc.rejectResource('lr-1', '  ', 'staff-1')).rejects.toThrow(
			svc.LocalResourceValidationError
		);
	});

	it('removes by stamping deletedAt, not by deleting the row', async () => {
		selectResults = [[{ id: 'lr-1', status: 'published' }]];

		await svc.removeResource('lr-1');

		expect(updateValues[0].deletedAt).toBeInstanceOf(Date);
		expect(deleteCalls).toBe(0);
	});
});

describe('deleteCategory', () => {
	it('refuses while any listing still points at it', async () => {
		selectResults = [[{ n: 2 }]];

		await expect(svc.deleteCategory('c-1')).rejects.toThrow(svc.LocalResourceCategoryInUseError);
		expect(deleteCalls).toBe(0);
	});

	it('deletes an unused one', async () => {
		selectResults = [[{ n: 0 }]];

		await svc.deleteCategory('c-1');

		expect(deleteCalls).toBe(1);
	});
});
