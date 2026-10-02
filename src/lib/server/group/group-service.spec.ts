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
	op: 'insert' | 'update' | 'delete';
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
		delete: (table: unknown) => ({
			where: (clause: unknown) => {
				writes.push({ table: tableName(table), op: 'delete', values: {}, where: clause });
				return { returning: () => Promise.resolve([]) };
			}
		}),
		batch: (queries: unknown[]) => Promise.resolve(queries.map(() => []))
	}
}));

const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...a) }
}));

const bandServiceCreate = vi.fn(async () => ({ id: 'group-1', slug: 'real-book-club' }));
vi.mock('$lib/server/band/band-service', () => ({
	create: (...a: unknown[]) => bandServiceCreate(...(a as [])),
	deactivate: vi.fn(),
	reactivate: vi.fn()
}));

const recordAuditEntry = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/audit/audit-service', () => ({
	recordAuditEntry: (...a: unknown[]) => recordAuditEntry(...a)
}));

import {
	createGroup,
	joinGroup,
	leaveGroup,
	listGroups,
	updateGroupProfile,
	updateGroupSettings,
	AlreadyOnRosterError,
	ApplyInsteadError,
	GroupNotFoundError,
	NotAStaffGroupError,
	NotJoinableError,
	NotOnRosterError,
	setChairRole
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

// Staff pick both at creation now (#1106); these tests are about other rules.
const SETTINGS = { joinPolicy: 'invite_only' as const, visibility: 'public' as const };

describe('createGroup', () => {
	it('creates a club through the shared group create', async () => {
		await createGroup({ ...SETTINGS, kind: 'club', name: 'Real Book Club', chairId: 'user-1' });

		expect(bandServiceCreate).toHaveBeenCalledWith('user-1', {
			kind: 'club',
			name: 'Real Book Club',
			bio: undefined,
			joinPolicy: 'invite_only',
			joinInstructions: undefined,
			visibility: 'public'
		});
	});

	// #1106. The column defaults are `invite_only` and a `public` listing, which
	// together advertise a group nobody can join. Staff's choice has to reach the
	// insert, or the group is born wrong and nothing says so.
	it('carries the chosen policy and visibility into the insert', async () => {
		await createGroup({
			kind: 'club',
			name: 'Real Book Club',
			chairId: 'user-1',
			joinPolicy: 'open',
			joinInstructions: 'Third Thursday, 7pm.',
			visibility: 'members'
		});

		expect(bandServiceCreate).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				joinPolicy: 'open',
				joinInstructions: 'Third Thursday, 7pm.',
				visibility: 'members'
			})
		);
	});

	/**
	 * The governance line this module exists to draw. A band is a member's own
	 * project, created by that member; letting the staff panel mint one would
	 * make staff its owner, which is not a relationship the model has.
	 */
	it('refuses to create a band', async () => {
		await expect(
			createGroup({ ...SETTINGS, kind: 'band' as never, name: 'Not A Band', chairId: 'user-1' })
		).rejects.toBeInstanceOf(NotAStaffGroupError);
		expect(bandServiceCreate).not.toHaveBeenCalled();
	});

	/** A program with no chair is legal; staff add chairs from its page later. */
	it('creates one with no chair, and writes no roster row', async () => {
		await createGroup({ ...SETTINGS, kind: 'committee', name: 'Booking', chairId: null });
		expect(bandServiceCreate).toHaveBeenCalledWith(
			null,
			expect.objectContaining({ name: 'Booking' })
		);
	});

	it('treats an empty string the same as absent, since that is what a blank field sends', async () => {
		await createGroup({ ...SETTINGS, kind: 'club', name: 'Chairless', chairId: '' });
		expect(bandServiceCreate).toHaveBeenCalledWith(null, expect.anything());
	});
});

// Programs have chairs (admins), never an owner (#1760).
describe('setChairRole', () => {
	const CLUB = { id: 'group-1', kind: 'club', name: 'Real Book Club' };
	const COMMITTEE = { id: 'group-2', kind: 'committee', name: 'Booking' };

	it('404s a group that does not exist', async () => {
		selectResultQueue = [[]];
		await expect(setChairRole('nope', 'user-2', 'admin')).rejects.toBeInstanceOf(
			GroupNotFoundError
		);
	});

	it('refuses a band, which keeps its one owner', async () => {
		selectResultQueue = [[{ id: 'band-1', kind: 'band', name: 'Wren' }]];
		await expect(setChairRole('band-1', 'user-2', 'admin')).rejects.toBeInstanceOf(
			NotAStaffGroupError
		);
		expect(writes).toEqual([]);
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});

	it('makes a club member a chair, and audits it', async () => {
		selectResultQueue = [[CLUB], [{ id: 'member-9', role: 'member', name: 'Nine' }]];

		await setChairRole('group-1', 'user-9', 'admin');

		expect(writes).toEqual([
			expect.objectContaining({
				table: 'group_member',
				op: 'update',
				values: expect.objectContaining({ role: 'admin' })
			})
		]);
		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'group.role_changed',
			subject: { type: 'group', id: 'group-1', label: 'Real Book Club' },
			details: { userId: 'user-9', memberName: 'Nine', role: 'admin', added: false }
		});
	});

	it('takes the chair away in a committee, leaving them on the roster', async () => {
		selectResultQueue = [[COMMITTEE], [{ id: 'member-9', role: 'admin', name: 'Nine' }]];

		await setChairRole('group-2', 'user-9', 'member');

		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({ op: 'update', values: { role: 'member' } });
	});

	it('adds someone not on the roster as an active chair, never an owner', async () => {
		selectResultQueue = [[CLUB], [], [{ name: 'New' }]];

		await setChairRole('group-1', 'user-new', 'admin');

		expect(writes).toEqual([
			{
				table: 'group_member',
				op: 'insert',
				values: { groupId: 'group-1', userId: 'user-new', role: 'admin', status: 'active' }
			}
		]);
		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({ details: expect.objectContaining({ added: true }) })
		);
	});

	it('404s demoting someone who is not on the roster', async () => {
		selectResultQueue = [[CLUB], []];
		await expect(setChairRole('group-1', 'user-x', 'member')).rejects.toBeInstanceOf(
			NotOnRosterError
		);
		expect(writes).toEqual([]);
	});

	it('writes and audits nothing when the role is already right', async () => {
		selectResultQueue = [[CLUB], [{ id: 'member-9', role: 'admin', name: 'Nine' }]];
		await setChairRole('group-1', 'user-9', 'admin');
		expect(writes).toEqual([]);
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});
});

describe('updateGroupProfile', () => {
	/**
	 * `name` and `bio` are mirrored onto the listing for the same reason
	 * band-service `update` mirrors them: the directory orders and searches on
	 * the copy, so writing only `group` leaves the old name showing.
	 */
	it('mirrors the name and bio onto the listing', async () => {
		await updateGroupProfile('group-1', { name: 'Real Book Club', bio: 'A monthly jam' });

		expect(writes).toEqual([
			expect.objectContaining({
				table: 'group',
				values: expect.objectContaining({ name: 'Real Book Club', bio: 'A monthly jam' })
			}),
			expect.objectContaining({
				table: 'directory_entry',
				values: expect.objectContaining({ name: 'Real Book Club', bio: 'A monthly jam' })
			})
		]);
	});

	/** Group-only: a listing has no join instructions to keep in step. */
	it('writes the join instructions to the group alone', async () => {
		await updateGroupProfile('group-1', { joinInstructions: 'Third Thursday, 7pm' });

		expect(writes[0]).toMatchObject({
			table: 'group',
			values: { joinInstructions: 'Third Thursday, 7pm' }
		});
		expect(writes[1].values).not.toHaveProperty('joinInstructions');
	});

	it('clears the instructions when they are submitted empty', async () => {
		await updateGroupProfile('group-1', { joinInstructions: '' });
		expect(writes[0].values).toMatchObject({ joinInstructions: null });
	});

	/**
	 * The authority split this exists to make true. A leader edits their own
	 * program's identity; who may walk in and whether it is advertised stay
	 * `updateGroupSettings`', which is staff-guarded.
	 */
	it.each([['joinPolicy'], ['visibility']])('never writes %s', async (column) => {
		await updateGroupProfile('group-1', {
			name: 'Real Book Club',
			bio: 'A monthly jam',
			joinInstructions: 'Bring a horn'
		});

		for (const write of writes) expect(write.values).not.toHaveProperty(column);
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

describe('joinGroup', () => {
	/**
	 * The policy is re-read from the resolved group and never taken from the
	 * request. That is what makes three doors no riskier than two: which door is
	 * open is the group's own fact, and a caller naming a group cannot also tell
	 * the service how to let them in.
	 */
	it('lands an `open` group straight on an active membership', async () => {
		selectResultQueue = [[{ joinPolicy: 'open', kind: 'club' }], []];

		const result = await joinGroup('group-1', 'user-2');

		expect(result.status).toBe('active');
		expect(writes[0]).toMatchObject({
			table: 'group_member',
			op: 'insert',
			// Self-join never assigns a role: owners and admins cannot self-appoint.
			values: { role: 'member', status: 'active', invitedById: null }
		});
	});

	// An application has answers and a decision; `submitApplication` is its door.
	it('sends a `by_application` group to the application instead, writing nothing', async () => {
		selectResultQueue = [[{ joinPolicy: 'by_application', kind: 'club' }], []];

		await expect(joinGroup('group-1', 'user-2')).rejects.toBeInstanceOf(ApplyInsteadError);
		expect(writes).toEqual([]);
		expect(emit).not.toHaveBeenCalled();
	});

	it('announces nothing for an `open` join, which has nobody to approve it', async () => {
		selectResultQueue = [[{ joinPolicy: 'open', kind: 'club' }], []];
		await joinGroup('group-1', 'user-2');
		expect(emit).not.toHaveBeenCalled();
	});

	it('refuses an invite-only group', async () => {
		selectResultQueue = [[{ joinPolicy: 'invite_only', kind: 'committee' }], []];

		await expect(joinGroup('group-1', 'user-2')).rejects.toBeInstanceOf(NotJoinableError);
		expect(writes).toEqual([]);
	});

	/**
	 * Bands are always `invite_only`, and this is the reason: a band member may
	 * book rehearsal time against the band's credits and then its card, so an
	 * `open` band would be a way to join a stranger's band and spend their money.
	 * Closed by the policy the service reads, not by a check at the call site.
	 */
	it('refuses a band, because a band is always invite only', async () => {
		selectResultQueue = [[{ joinPolicy: 'invite_only', kind: 'band' }], []];

		await expect(joinGroup('band-1', 'user-2')).rejects.toBeInstanceOf(NotJoinableError);
	});

	it('404s a group that does not exist or is deactivated', async () => {
		selectResultQueue = [[]];
		await expect(joinGroup('gone', 'user-2')).rejects.toBeInstanceOf(GroupNotFoundError);
	});

	it('refuses somebody already on the roster rather than writing a second row', async () => {
		selectResultQueue = [[{ joinPolicy: 'open', kind: 'club' }], [{ id: 'member-1' }]];

		await expect(joinGroup('group-1', 'user-2')).rejects.toBeInstanceOf(AlreadyOnRosterError);
		expect(writes).toEqual([]);
	});
});

describe('leaveGroup', () => {
	/**
	 * The one place programs and bands diverge on leaving. A band owner must
	 * transfer first, because nobody's job it is to pick up an orphaned band; a
	 * program leader was appointed, and the body that appointed them is still
	 * there. "Find your own replacement" would trap someone in a volunteer role
	 * they have already said they are done with.
	 */
	it('lets a leader step down without naming a successor', async () => {
		selectResultQueue = [[{ id: 'member-1' }]];
		await expect(leaveGroup('group-1', 'user-1')).resolves.toBeUndefined();
	});

	it('404s somebody who is not on the roster', async () => {
		selectResultQueue = [[]];
		await expect(leaveGroup('group-1', 'stranger')).rejects.toBeInstanceOf(GroupNotFoundError);
	});
});

describe('listGroups', () => {
	it('searches names with _ and % matched literally', async () => {
		await listGroups({ search: '50%_off' });
		// The list's own WHERE, not the open-applications subquery built before it.
		const dialect = new SQLiteSyncDialect();
		const rendered = whereClauses
			.map((c) => dialect.sqlToQuery(c as SQL))
			.find((q) => q.sql.includes('"group"."name"'))!;
		expect(rendered.sql).toContain(`"group"."name" like ? escape '\\'`);
		expect(rendered.params).toContain('%50\\%\\_off%');
	});
});
