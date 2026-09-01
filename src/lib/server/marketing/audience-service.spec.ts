import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let selectCallIndex = 0;
const insertedRows: unknown[] = [];
const upserts: unknown[] = [];
let updateData: unknown[] = [];
let deleteCalled = false;

function buildChain() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				const result = selectResults[selectCallIndex] ?? [];
				selectCallIndex++;
				return (resolve: (v: unknown[]) => void) => resolve(result);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => buildChain(),
		selectDistinct: () => buildChain(),
		insert: () => ({
			values: (row: unknown) => {
				insertedRows.push(row);
				return {
					returning: () =>
						Promise.resolve([{ id: 'aud-new', ...(typeof row === 'object' ? row : {}) }]),
					onConflictDoUpdate: (opts: unknown) => {
						upserts.push(opts);
						return Promise.resolve(undefined);
					},
					onConflictDoNothing: () => Promise.resolve(undefined)
				};
			}
		}),
		update: () => {
			const chain: any = new Proxy(() => chain, {
				get(_, prop) {
					if (prop === 'set')
						return (data: unknown) => {
							updateData.push(data);
							return chain;
						};
					if (prop === 'returning') return () => Promise.resolve([{ id: 'aud-1' }]);
					if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(undefined);
					return () => chain;
				}
			});
			return chain;
		},
		delete: () => {
			deleteCalled = true;
			return buildChain();
		}
	}
}));

vi.mock('$lib/server/db/schema/marketing', () => ({
	audience: {
		id: 'id',
		name: 'name',
		slug: 'slug',
		description: 'description',
		allowOptIn: 'allow_opt_in',
		createdAt: 'created_at'
	},
	audienceMember: {
		id: 'id',
		audienceId: 'audience_id',
		subscriberId: 'subscriber_id',
		unsubscribedAt: 'unsubscribed_at',
		createdAt: 'created_at'
	},
	subscriber: { id: 'id', email: 'email', name: 'name', userId: 'user_id' }
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'id', email: 'email', name: 'name', deletedAt: 'deleted_at' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	sql: vi.fn(),
	isNull: vi.fn(),
	isNotNull: vi.fn(),
	inArray: vi.fn(),
	notInArray: vi.fn()
}));

// Resolution of built-in audiences is system-audiences.ts's job and is covered
// by its own spec. Here we only care that audience-service branches on it.
vi.mock('./system-audiences', () => ({
	ensureSystemAudiences: vi.fn(async () => {}),
	isSystemAudienceKey: vi.fn((key: unknown) => key === 'all-members'),
	countSystemAudience: vi.fn(async () => 999),
	previewSystemAudience: vi.fn(async () => [{ email: 'member@example.com' }]),
	getSystemAudiencesForUser: vi.fn(async () => [])
}));

vi.mock('./subscriber-service', () => ({
	findOrCreateByEmail: vi.fn(async (email: string, name: string) => ({
		id: 'sub-1',
		email,
		name,
		userId: null
	})),
	linkToUser: vi.fn()
}));

const {
	createAudience,
	updateAudience,
	deleteAudience,
	listAudiences,
	getAudience,
	listSubscribers,
	addSubscriber,
	removeSubscriber,
	bulkAddMembers,
	unsubscribe,
	BuiltInAudienceError,
	AudienceValidationError
} = await import('./audience-service');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Every membership mutation begins with a systemKey lookup. These queue its
 * result so the following selectResults line up with the real query.
 */
function staticAudience() {
	selectResults.push([{ systemKey: null }]);
}
function builtInAudience() {
	selectResults.push([{ systemKey: 'all-members' }]);
}

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	selectCallIndex = 0;
	insertedRows.length = 0;
	upserts.length = 0;
	updateData = [];
	deleteCalled = false;
});

describe('createAudience', () => {
	it('creates an audience with valid data', async () => {
		const result = await createAudience({ name: 'Newsletter', slug: 'newsletter' });

		expect(result.id).toBe('aud-new');
		expect(insertedRows[0]).toMatchObject({
			name: 'Newsletter',
			slug: 'newsletter',
			allowOptIn: false
		});
	});

	it('throws when name is too long', async () => {
		await expect(createAudience({ name: 'x'.repeat(256), slug: 'test' })).rejects.toThrow(
			AudienceValidationError
		);
	});

	it('throws when slug is too long', async () => {
		await expect(createAudience({ name: 'OK', slug: 'x'.repeat(101) })).rejects.toThrow(
			AudienceValidationError
		);
	});

	it('throws when slug has invalid characters', async () => {
		await expect(createAudience({ name: 'OK', slug: 'Bad Slug!' })).rejects.toThrow(
			AudienceValidationError
		);
	});
});

describe('updateAudience', () => {
	it('updates audience fields', async () => {
		const result = await updateAudience('aud-1', { name: 'Updated' });

		expect(result).toBeTruthy();
		expect(updateData[0]).toMatchObject({ name: 'Updated' });
	});

	it('validates slug format on update', async () => {
		await expect(updateAudience('aud-1', { slug: 'INVALID!' })).rejects.toThrow(
			AudienceValidationError
		);
	});
});

describe('deleteAudience', () => {
	it('deletes the audience', async () => {
		staticAudience();
		await deleteAudience('aud-1');
		expect(deleteCalled).toBe(true);
	});
});

describe('addSubscriber', () => {
	it('inserts new membership when subscriber not in audience', async () => {
		staticAudience();
		// Check existing membership: not found
		selectResults.push([]);

		await addSubscriber('aud-1', 'sub-1');

		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			audienceId: 'aud-1',
			subscriberId: 'sub-1'
		});
	});

	it('re-subscribes when previously unsubscribed', async () => {
		staticAudience();
		selectResults.push([{ id: 'am-1', unsubscribedAt: new Date() }]);

		await addSubscriber('aud-1', 'sub-1');

		expect(updateData[0]).toMatchObject({ unsubscribedAt: null });
	});

	it('does nothing when already active', async () => {
		staticAudience();
		selectResults.push([{ id: 'am-1', unsubscribedAt: null }]);

		await addSubscriber('aud-1', 'sub-1');

		expect(insertedRows).toHaveLength(0);
		expect(updateData).toHaveLength(0);
	});
});

describe('removeSubscriber', () => {
	it('deletes the audience member row', async () => {
		staticAudience();
		await removeSubscriber('aud-1', 'sub-1');
		expect(deleteCalled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Built-in audience guardrails
// ---------------------------------------------------------------------------
// A built-in audience's membership is a SQL predicate, so there is no list to
// edit. Each mutation must refuse rather than silently write rows that the
// resolver would then ignore.

describe('built-in audience guardrails', () => {
	it('refuses to delete a built-in audience', async () => {
		builtInAudience();
		await expect(deleteAudience('aud-sys')).rejects.toThrow(BuiltInAudienceError);
		expect(deleteCalled).toBe(false);
	});

	it('refuses to add a subscriber to a built-in audience', async () => {
		builtInAudience();
		await expect(addSubscriber('aud-sys', 'sub-1')).rejects.toThrow(BuiltInAudienceError);
		expect(insertedRows).toHaveLength(0);
	});

	it('refuses to remove a subscriber from a built-in audience', async () => {
		builtInAudience();
		await expect(removeSubscriber('aud-sys', 'sub-1')).rejects.toThrow(BuiltInAudienceError);
		expect(deleteCalled).toBe(false);
	});

	it('refuses to bulk-add members to a built-in audience', async () => {
		builtInAudience();
		await expect(bulkAddMembers('aud-sys')).rejects.toThrow(BuiltInAudienceError);
		expect(insertedRows).toHaveLength(0);
	});

	it('refuses to change a built-in audience slug', async () => {
		builtInAudience();
		await expect(updateAudience('aud-sys', { slug: 'renamed' })).rejects.toThrow(
			BuiltInAudienceError
		);
		expect(updateData).toHaveLength(0);
	});

	it('refuses to open a built-in audience to public opt-in', async () => {
		builtInAudience();
		await expect(updateAudience('aud-sys', { allowOptIn: true })).rejects.toThrow(
			BuiltInAudienceError
		);
		expect(updateData).toHaveLength(0);
	});

	it('still allows editing a built-in audience name and description', async () => {
		builtInAudience();

		await updateAudience('aud-sys', { name: 'Everyone', description: 'All of them' });

		expect(updateData[0]).toMatchObject({ name: 'Everyone', description: 'All of them' });
	});

	it('reports the live count for a built-in audience instead of the row count', async () => {
		selectResults.push([
			{
				id: 'aud-sys',
				name: 'All Members',
				slug: 'all-members',
				description: null,
				allowOptIn: false,
				systemKey: 'all-members',
				createdAt: new Date(),
				// audience_member rows for a built-in are opt-out tombstones, so this
				// joined count is meaningless and must not be surfaced.
				subscriberCount: 3
			}
		]);

		const result = await getAudience('aud-sys');

		expect(result!.subscriberCount).toBe(999);
	});

	it('lists a live preview instead of tombstone rows for a built-in audience', async () => {
		builtInAudience();

		const result = await listSubscribers('aud-sys');

		expect(result).toEqual([{ email: 'member@example.com' }]);
	});
});

describe('unsubscribe', () => {
	// Upsert, not update: a built-in audience has no membership row to flip, so
	// the inserted row IS the opt-out record. Update-only made one-click
	// unsubscribe a silent no-op for built-ins.
	it('inserts a tombstone row carrying the opt-out timestamp', async () => {
		await unsubscribe('sub-1', 'aud-1');

		expect(insertedRows[0]).toMatchObject({
			subscriberId: 'sub-1',
			audienceId: 'aud-1',
			unsubscribedAt: expect.any(Date)
		});
	});

	it('upserts so an existing membership row is flipped rather than duplicated', async () => {
		await unsubscribe('sub-1', 'aud-1');

		expect(upserts).toHaveLength(1);
		expect(upserts[0]).toMatchObject({ set: { unsubscribedAt: expect.any(Date) } });
	});
});

describe('listAudiences', () => {
	it('returns audiences with subscriber counts', async () => {
		selectResults.push([
			{
				id: 'aud-1',
				name: 'Newsletter',
				slug: 'newsletter',
				description: null,
				allowOptIn: true,
				createdAt: new Date(),
				subscriberCount: 42
			}
		]);

		const result = await listAudiences();
		expect(result[0].subscriberCount).toBe(42);
	});
});

describe('getAudience', () => {
	it('returns null when not found', async () => {
		selectResults.push([]);
		const result = await getAudience('nonexistent');
		expect(result).toBeNull();
	});

	it('returns audience with subscriber count', async () => {
		selectResults.push([
			{
				id: 'aud-1',
				name: 'Events',
				slug: 'events',
				description: 'Event updates',
				allowOptIn: true,
				createdAt: new Date(),
				subscriberCount: 10
			}
		]);

		const result = await getAudience('aud-1');
		expect(result!.name).toBe('Events');
	});
});
