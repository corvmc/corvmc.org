import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Rows the next `select()` resolves to, one array per statement. */
let selectResultQueue: unknown[][] = [];
let selectResult: unknown[] = [];
/** Predicates handed to `.where()`, so a test can render them to real SQL. */
let whereClauses: unknown[] = [];
/** What the batch was asked to write, so a test can assert on rows not calls. */
let writes: {
	table: string;
	op: 'insert' | 'update';
	values: Record<string, unknown>;
	where?: unknown;
}[] = [];

/** Drizzle stores a table's name under a well-known symbol. */
function tableName(table: unknown): string {
	if (!table || typeof table !== 'object') return 'unknown';
	const sym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
	return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'where') {
				return (clause: unknown) => {
					whereClauses.push(clause);
					return proxy;
				};
			}
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		$count: vi.fn(() => 0),
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => {
				writes.push({ table: tableName(table), op: 'insert', values });
				return { returning: () => Promise.resolve([]) };
			}
		}),
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => {
				const write = { table: tableName(table), op: 'update' as const, values };
				writes.push(write);
				return {
					// Kept on the write rather than in the shared `whereClauses` list:
					// which statement a predicate belongs to is the assertion here.
					where: (clause: unknown) => {
						(write as { where?: unknown }).where = clause;
						return { returning: () => Promise.resolve([]) };
					}
				};
			}
		}),
		batch: (queries: unknown[]) => Promise.resolve(queries.map(() => []))
	}
}));

const bandServiceCreate = vi.fn(async () => ({ id: 'group-1', slug: 'real-book-club' }));
vi.mock('$lib/server/band/band-service', () => ({
	create: (...a: unknown[]) => bandServiceCreate(...(a as [])),
	deactivate: vi.fn(),
	reactivate: vi.fn()
}));

import {
	assignLeader,
	createGroup,
	updateGroupSettings,
	GroupNotFoundError,
	LeaderNotFoundError,
	NotAStaffGroupError
} from './group-service';

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [];
	selectResultQueue = [];
	whereClauses = [];
	writes = [];
	bandServiceCreate.mockResolvedValue({ id: 'group-1', slug: 'real-book-club' });
});

// ---------------------------------------------------------------------------

describe('createGroup', () => {
	it('creates a club through the shared group create', async () => {
		await createGroup({ kind: 'club', name: 'Real Book Club', leaderId: 'user-1' });

		expect(bandServiceCreate).toHaveBeenCalledWith('user-1', {
			kind: 'club',
			name: 'Real Book Club',
			bio: undefined
		});
	});

	/**
	 * The governance line this module exists to draw. A band is a member's own
	 * project, created by that member; letting the staff panel mint one would
	 * make staff its owner, which is not a relationship the model has.
	 */
	it('refuses to create a band', async () => {
		await expect(
			createGroup({ kind: 'band' as never, name: 'Not A Band', leaderId: 'user-1' })
		).rejects.toBeInstanceOf(NotAStaffGroupError);
		expect(bandServiceCreate).not.toHaveBeenCalled();
	});

	/**
	 * A program created with an empty owner seat is a program nobody has been
	 * told they run. The seat is legal to be empty *later* — a leader steps down
	 * — but never at creation, which is staff recording an arrangement that
	 * already exists.
	 */
	it('refuses to create one with no leader', async () => {
		await expect(
			createGroup({ kind: 'club', name: 'Leaderless', leaderId: '' })
		).rejects.toBeInstanceOf(LeaderNotFoundError);
		expect(bandServiceCreate).not.toHaveBeenCalled();
	});
});

describe('assignLeader', () => {
	it('404s a group that does not exist', async () => {
		selectResultQueue = [[]];
		await expect(assignLeader('nope', 'user-2')).rejects.toBeInstanceOf(GroupNotFoundError);
	});

	/**
	 * Demote then promote, in that order. The partial unique index on
	 * `(groupId) WHERE role = 'owner'` is what makes the order load-bearing:
	 * promoting first would momentarily give the group two owner rows and be
	 * refused outright.
	 */
	it('demotes the incumbent before promoting the appointee', async () => {
		selectResultQueue = [[{ id: 'group-1' }], [{ id: 'member-9', role: 'member' }]];

		await assignLeader('group-1', 'user-2');

		expect(writes.map((w) => w.values.role)).toEqual(['admin', 'owner']);
	});

	/** The appointee may not be on the roster at all. */
	it('inserts an owner row for someone who is not yet a member', async () => {
		selectResultQueue = [[{ id: 'group-1' }], []];

		await assignLeader('group-1', 'user-new');

		const promote = writes.at(-1)!;
		expect(promote.op).toBe('insert');
		// Appointed, not invited — there is nothing for them to accept.
		expect(promote.values).toMatchObject({ role: 'owner', status: 'active', userId: 'user-new' });
	});

	/** Re-appointing the sitting leader must not demote them to admin. */
	it('does not demote the person being appointed', async () => {
		selectResultQueue = [[{ id: 'group-1' }], [{ id: 'member-1', role: 'owner' }]];

		await assignLeader('group-1', 'user-1');

		const dialect = new SQLiteSyncDialect();
		const demote = writes.find((w) => w.values.role === 'admin')!;
		const rendered = dialect.sqlToQuery(demote.where as SQL);
		expect(rendered.sql).toContain('<>');
		expect(rendered.params).toContain('user-1');
	});
});

describe('updateGroupSettings', () => {
	/**
	 * Two tables, because the two settings live in different places: the policy
	 * is the group's own and the visibility belongs to its listing, which is the
	 * same `directory_entry` a band is listed through. One visibility rather than
	 * two that can disagree.
	 */
	it('writes the policy to the group and the visibility to its entry', async () => {
		await updateGroupSettings('group-1', {
			joinPolicy: 'open',
			joinInstructions: 'Bring a horn',
			visibility: 'public'
		});

		expect(writes).toEqual([
			expect.objectContaining({
				table: 'group',
				values: expect.objectContaining({ joinPolicy: 'open', joinInstructions: 'Bring a horn' })
			}),
			expect.objectContaining({
				table: 'directory_entry',
				values: expect.objectContaining({ visibility: 'public' })
			})
		]);
	});

	it('clears the instructions when they are submitted empty', async () => {
		await updateGroupSettings('group-1', { joinInstructions: '' });
		expect(writes[0].values).toMatchObject({ joinInstructions: null });
	});

	it('writes nothing when it is handed nothing', async () => {
		await updateGroupSettings('group-1', {});
		expect(writes).toEqual([]);
	});
});
