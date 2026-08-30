import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// The db is faked; `renderMarkdown` is NOT. It is pure `marked` + `xss` with no
// DOM and no environment, so mocking it would replace the one part of `shape()`
// that can actually be wrong with a stub that always agrees.

/** Rows the next select resolves to, one array per statement. */
let selectQueue: unknown[][] = [];
/** Rows the next `.returning()` resolves to, one array per statement. */
let returningQueue: unknown[][] = [];
/** Every statement, with the predicate kept beside the write it belongs to. */
let statements: {
	op: 'select' | 'update' | 'insert';
	values?: Record<string, unknown>;
	where?: unknown;
}[] = [];

function next(queue: unknown[][]): unknown[] {
	return queue.length > 0 ? queue.shift()! : [];
}

function selectChain(record: { where?: unknown }) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'where') {
				return (clause: unknown) => {
					record.where = clause;
					return proxy;
				};
			}
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(next(selectQueue));
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => {
			const record: { op: 'select'; where?: unknown } = { op: 'select' };
			statements.push(record);
			return selectChain(record);
		},
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				statements.push({ op: 'insert', values });
				return { returning: () => Promise.resolve(next(returningQueue)) };
			}
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				const record = { op: 'update' as const, values };
				statements.push(record);
				return {
					where: (clause: unknown) => {
						(record as { where?: unknown }).where = clause;
						return { returning: () => Promise.resolve(next(returningQueue)) };
					}
				};
			}
		})
	}
}));

const {
	listPublished,
	listForManager,
	getById,
	create,
	update,
	publish,
	remove,
	AnnouncementNotFoundError,
	AlreadyPublishedError
} = await import('./announcement-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dialect = new SQLiteSyncDialect();

/** The rendered SQL of a statement's WHERE, so a test asserts on meaning. */
function whereOf(index: number): string {
	const clause = statements[index]?.where;
	if (!clause) return '';
	return dialect.sqlToQuery(clause as Parameters<typeof dialect.sqlToQuery>[0]).sql;
}

function lastWhere(): string {
	for (let i = statements.length - 1; i >= 0; i--) {
		if (statements[i].where) return whereOf(i);
	}
	return '';
}

function row(over: Record<string, unknown> = {}) {
	return {
		id: 'ann-1',
		groupId: 'group-1',
		title: 'Session moved',
		body: 'The jam is **next** Thursday.',
		pinned: false,
		publishedAt: new Date('2026-08-01'),
		notifiedAt: null,
		recipientCount: null,
		createdAt: new Date('2026-07-30'),
		updatedAt: new Date('2026-07-30'),
		author: { id: 'user-1', name: 'Alice', email: 'a@x.test', pronouns: null },
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	selectQueue = [];
	returningQueue = [];
	statements = [];
});

// ---------------------------------------------------------------------------

describe('listPublished', () => {
	it('excludes drafts and deleted posts, scoped to the group', async () => {
		selectQueue.push([row()]);

		await listPublished('group-1');

		const where = lastWhere();
		expect(where).toContain('"group_id" = ?');
		expect(where).toContain('"deleted_at" is null');
		// The whole difference between this and the manager list.
		expect(where).toContain('"published_at" is not null');
	});

	it('renders the body to sanitized HTML beside the markdown source', async () => {
		selectQueue.push([row({ body: 'The jam is **next** Thursday.' })]);

		const [post] = await listPublished('group-1');

		expect(post.body).toBe('The jam is **next** Thursday.');
		expect(post.bodyHtml).toContain('<strong>next</strong>');
	});

	/**
	 * The body is member-authored markdown rendered as HTML on a page other
	 * members read, which is the exact shape of a stored XSS. `renderMarkdown`
	 * runs the js-xss allowlist; this is here so that a later "just use
	 * marked.parse" cannot quietly remove it.
	 */
	it('strips script from an authored body', async () => {
		selectQueue.push([row({ body: 'Hello <script>alert(1)</script> there' })]);

		const [post] = await listPublished('group-1');

		expect(post.bodyHtml).not.toContain('<script>');
		expect(post.bodyHtml).not.toContain('alert(1)');
	});

	it('reports no author once the account is gone', async () => {
		// `author_id` is ON DELETE SET NULL, so the left join yields null columns.
		selectQueue.push([row({ author: { id: null, name: null, email: null, pronouns: null } })]);

		const [post] = await listPublished('group-1');

		expect(post.author).toBeNull();
	});
});

describe('listForManager', () => {
	it('includes drafts', async () => {
		selectQueue.push([row({ publishedAt: null })]);

		await listForManager('group-1');

		const where = lastWhere();
		expect(where).toContain('"group_id" = ?');
		expect(where).toContain('"deleted_at" is null');
		expect(where).not.toContain('"published_at" is not null');
	});
});

describe('getById', () => {
	/**
	 * The guard at the remote boundary proves the caller administers *a* group.
	 * Without `group_id` in the predicate, an id alone would let an admin of one
	 * group read another group's unpublished draft.
	 */
	it('scopes the lookup to the group, not just the id', async () => {
		selectQueue.push([row()]);

		await getById('ann-1', 'group-1');

		const where = lastWhere();
		expect(where).toContain('"id" = ?');
		expect(where).toContain('"group_id" = ?');
	});

	it('404s an id that belongs to another group', async () => {
		selectQueue.push([]);

		await expect(getById('ann-other', 'group-1')).rejects.toBeInstanceOf(AnnouncementNotFoundError);
	});
});

describe('create', () => {
	it('writes a draft — no publishedAt', async () => {
		returningQueue.push([{ id: 'ann-new' }]);
		selectQueue.push([row({ id: 'ann-new', publishedAt: null })]);

		const post = await create('group-1', 'user-1', { title: '  Trimmed  ', body: 'Body' });

		const insert = statements.find((s) => s.op === 'insert');
		expect(insert?.values).toMatchObject({
			groupId: 'group-1',
			authorId: 'user-1',
			title: 'Trimmed',
			body: 'Body',
			pinned: false
		});
		// Nothing reaches a member until publish() stamps it.
		expect(insert?.values).not.toHaveProperty('publishedAt');
		expect(post.publishedAt).toBeNull();
	});
});

describe('update', () => {
	it('scopes the write to the group and 404s when nothing matched', async () => {
		returningQueue.push([]);

		await expect(update('ann-1', 'group-1', { title: 'New' })).rejects.toBeInstanceOf(
			AnnouncementNotFoundError
		);
		expect(lastWhere()).toContain('"group_id" = ?');
	});

	it('leaves untouched fields out of the SET', async () => {
		returningQueue.push([{ id: 'ann-1' }]);
		selectQueue.push([row({ pinned: true })]);

		await update('ann-1', 'group-1', { pinned: true });

		const set = statements.find((s) => s.op === 'update')?.values;
		expect(set).toMatchObject({ pinned: true });
		expect(set).not.toHaveProperty('title');
		expect(set).not.toHaveProperty('body');
	});
});

describe('publish', () => {
	/**
	 * The double-publish guard, and it is in the UPDATE rather than in a SELECT
	 * before it on purpose: two admins clicking Publish on the same draft would
	 * both pass a read-then-write check, both emit, and the roster would be
	 * emailed twice — which cannot be taken back.
	 */
	it('conditions the write on the row still being unpublished', async () => {
		returningQueue.push([{ id: 'ann-1' }]);
		selectQueue.push([row()]);

		await publish('ann-1', 'group-1');

		const where = whereOf(statements.findIndex((s) => s.op === 'update'));
		expect(where).toContain('"published_at" is null');
		expect(where).toContain('"group_id" = ?');
	});

	it('tells an admin the post was already published, rather than 404ing', async () => {
		returningQueue.push([]); // the conditional update matched nothing
		selectQueue.push([{ publishedAt: new Date('2026-08-01') }]); // but the row exists

		await expect(publish('ann-1', 'group-1')).rejects.toBeInstanceOf(AlreadyPublishedError);
	});

	it('404s when the row is genuinely absent', async () => {
		returningQueue.push([]);
		selectQueue.push([]);

		await expect(publish('ann-1', 'group-1')).rejects.toBeInstanceOf(AnnouncementNotFoundError);
	});
});

describe('remove', () => {
	/**
	 * A soft delete. A committee's announcements are part of the record of the
	 * committee, and "we never said that" is not a claim a delete button should
	 * be able to make.
	 */
	it('stamps deletedAt rather than deleting the row', async () => {
		returningQueue.push([{ id: 'ann-1' }]);

		await remove('ann-1', 'group-1');

		const write = statements.find((s) => s.op === 'update');
		expect(write?.values).toHaveProperty('deletedAt');
		expect(statements.some((s) => s.op === ('delete' as never))).toBe(false);
	});

	it('404s an id from another group', async () => {
		returningQueue.push([]);

		await expect(remove('ann-1', 'group-1')).rejects.toBeInstanceOf(AnnouncementNotFoundError);
		expect(lastWhere()).toContain('"group_id" = ?');
	});
});
