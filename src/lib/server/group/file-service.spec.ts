import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// `$lib/server/db` and `$lib/server/private-storage` are faked; `storage-keys`
// is NOT. Those are pure functions with no bucket, and mocking them would
// replace the sanitization this module is supposed to apply with a stub that
// always agrees.
//
// Everything is recorded into one ordered journal, because two of the rules
// under test are about *sequence*: the row is inserted before the object is
// put, and the quota is checked before either.

/** Rows the next select resolves to, one array per statement. */
let selectQueue: unknown[][] = [];
/** Rows the next `.returning()` resolves to, one array per statement. */
let returningQueue: unknown[][] = [];

let statements: {
	op: 'select' | 'update' | 'insert' | 'delete';
	values?: Record<string, unknown>;
	where?: unknown;
}[] = [];

/** Ordered names of everything that happened, db and storage alike. */
let journal: string[] = [];

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
			journal.push('select');
			return selectChain(record);
		},
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				statements.push({ op: 'insert', values });
				journal.push('insert');
				return Promise.resolve(undefined);
			}
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				const record = { op: 'update' as const, values };
				statements.push(record);
				journal.push('update');
				return {
					where: (clause: unknown) => {
						(record as { where?: unknown }).where = clause;
						// Thenable AND chainable: `remove()` asks for `.returning()`,
						// while the soft-delete inside `upload()`'s catch awaits the
						// statement directly.
						return {
							returning: () => Promise.resolve(next(returningQueue)),
							then: (resolve: (v: unknown) => void) => resolve(undefined)
						};
					}
				};
			}
		}),
		delete: () => ({
			where: (clause: unknown) => {
				statements.push({ op: 'delete', where: clause });
				journal.push('delete');
				return Promise.resolve(undefined);
			}
		})
	}
}));

const putPrivateObject = vi.fn(async (key: string) => {
	journal.push('put');
	return key;
});

vi.mock('$lib/server/private-storage', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/private-storage')>(
		'$lib/server/private-storage'
	);
	return {
		// The real validator and the real constants: policy is what this module is
		// for, and a stubbed validator would test nothing.
		...actual,
		putPrivateObject: (key: string, body: ArrayBuffer, type: string) =>
			putPrivateObject(key, body, type),
		deletePrivateObject: vi.fn(async () => {
			journal.push('deleteObject');
		})
	};
});

const {
	list,
	getUsage,
	getForDownload,
	upload,
	remove,
	listAllKeys,
	listSweepCandidates,
	deleteRows,
	FileNotFoundError,
	DocumentsNotAvailableError,
	QuotaExceededError,
	InvalidDocumentError,
	DOCUMENT_QUOTA_BYTES,
	DOCUMENT_QUOTA_FILES
} = await import('./file-service');
const { deletePrivateObject } = await import('$lib/server/private-storage');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dialect = new SQLiteSyncDialect();

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
		id: 'file-1',
		groupId: 'group-1',
		filename: 'minutes.pdf',
		contentType: 'application/pdf',
		sizeBytes: 2048,
		description: null,
		createdAt: new Date('2026-08-01'),
		updatedAt: new Date('2026-08-01'),
		uploadedBy: { id: 'user-1', name: 'Alice', email: 'a@x.test', pronouns: null },
		...over
	};
}

/** A File whose bytes are never allocated — only these four members are read. */
function fileOf(over: Partial<{ type: string; size: number; name: string }> = {}) {
	return {
		type: 'application/pdf',
		size: 2048,
		name: 'minutes.pdf',
		arrayBuffer: async () => new ArrayBuffer(8),
		...over
	} as unknown as File;
}

/**
 * `upload()` reads the group, then the usage, then re-reads the inserted row.
 * Queueing all three keeps each test's arrangement about the case it is testing.
 */
function queueUploadReads(
	over: { kind?: string; used?: number; files?: number; result?: unknown } = {}
) {
	selectQueue.push([{ kind: over.kind ?? 'club' }]);
	selectQueue.push([{ used: over.used ?? 0, files: over.files ?? 0 }]);
	selectQueue.push([over.result ?? row()]);
}

beforeEach(() => {
	vi.clearAllMocks();
	selectQueue = [];
	returningQueue = [];
	statements = [];
	journal = [];
});

// ---------------------------------------------------------------------------

describe('list', () => {
	it('scopes to the group and excludes removed documents', async () => {
		selectQueue.push([row()]);

		await list('group-1');

		const where = lastWhere();
		expect(where).toContain('"group_id" = ?');
		expect(where).toContain('"deleted_at" is null');
	});

	it('never returns the R2 key', async () => {
		selectQueue.push([row()]);

		const [view] = await list('group-1');

		// The one column no client needs. Leaving it out of the shaped view means
		// no surface can leak it into a payload someone later hands to
		// `resolveImageUrl`.
		expect(view).not.toHaveProperty('key');
	});
});

describe('getUsage', () => {
	it('reports zero for a group that has uploaded nothing', async () => {
		// `sum()` over an empty set is null, and D1 returns it as such.
		selectQueue.push([{ used: null, files: 0 }]);

		const usage = await getUsage('group-1');

		expect(usage).toEqual({
			usedBytes: 0,
			fileCount: 0,
			quotaBytes: DOCUMENT_QUOTA_BYTES,
			quotaFiles: DOCUMENT_QUOTA_FILES
		});
	});

	it('coerces the sum, which D1 hands back as a string', async () => {
		selectQueue.push([{ used: '5242880', files: 3 }]);

		const usage = await getUsage('group-1');

		expect(usage.usedBytes).toBe(5242880);
	});

	it('counts only live rows', async () => {
		selectQueue.push([{ used: 0, files: 0 }]);

		await getUsage('group-1');

		expect(lastWhere()).toContain('"deleted_at" is null');
	});
});

describe('getForDownload', () => {
	it('takes an id alone and returns the group to authorize against', async () => {
		selectQueue.push([
			{
				id: 'file-1',
				groupId: 'group-1',
				key: 'groups/group-1/documents/file-1.pdf',
				filename: 'minutes.pdf',
				contentType: 'application/pdf',
				sizeBytes: 2048
			}
		]);

		const found = await getForDownload('file-1');

		expect(found?.groupId).toBe('group-1');
		expect(found?.key).toBe('groups/group-1/documents/file-1.pdf');
	});

	it('returns null for a removed document', async () => {
		selectQueue.push([]);

		expect(await getForDownload('file-1')).toBeNull();
		// The filter is what makes "removed" and "never existed" one answer to a
		// caller the route has not authorized for anything yet.
		expect(lastWhere()).toContain('"deleted_at" is null');
	});
});

describe('upload', () => {
	it('records the row and stores the object', async () => {
		queueUploadReads();

		await upload('group-1', 'user-1', { file: fileOf(), description: '  July minutes  ' });

		const insert = statements.find((s) => s.op === 'insert');
		expect(insert?.values).toMatchObject({
			groupId: 'group-1',
			filename: 'minutes.pdf',
			contentType: 'application/pdf',
			sizeBytes: 2048,
			description: 'July minutes',
			uploadedById: 'user-1'
		});
		expect(putPrivateObject).toHaveBeenCalledOnce();
	});

	/**
	 * The row is the only record of the key. Putting the object first and then
	 * failing the insert strands a file that is billed forever with nothing that
	 * knows its name — the inverse of every delete path, and for the same reason.
	 */
	it('inserts the row before putting the object', async () => {
		queueUploadReads();

		await upload('group-1', 'user-1', { file: fileOf() });

		expect(journal.indexOf('insert')).toBeLessThan(journal.indexOf('put'));
	});

	it('keys the object on the row id, not the filename', async () => {
		queueUploadReads();

		await upload('group-1', 'user-1', { file: fileOf({ name: 'minutes.pdf' }) });

		const [key] = putPrivateObject.mock.calls[0];
		expect(key).toMatch(/^groups\/group-1\/documents\/[0-9a-f-]{36}\.pdf$/);
		expect(key).not.toContain('minutes');
	});

	it('sanitizes the filename at write time', async () => {
		queueUploadReads();

		await upload('group-1', 'user-1', {
			file: fileOf({ name: 'evil\r\nX-Injected: 1.pdf' })
		});

		const insert = statements.find((s) => s.op === 'insert');
		expect(insert?.values?.filename).toBe('evilX-Injected: 1.pdf');
	});

	it('soft-deletes the row when the object fails to store', async () => {
		queueUploadReads();
		putPrivateObject.mockRejectedValueOnce(new Error('R2 down'));

		await expect(upload('group-1', 'user-1', { file: fileOf() })).rejects.toThrow('R2 down');

		// A row pointing at nothing would sit in the list as a download that 404s
		// and count against the quota for a file nobody has.
		const update = statements.find((s) => s.op === 'update');
		expect(update?.values).toHaveProperty('deletedAt');
	});

	// ---- policy -----------------------------------------------------------

	/**
	 * Bands hold a rider and a stage plot through the public `media` slots, and
	 * nothing else. The check is here rather than only in the remote function so
	 * a staff tool, a backfill or an import cannot route around it.
	 */
	it('refuses a band, without validating or storing anything', async () => {
		selectQueue.push([{ kind: 'band' }]);

		await expect(upload('group-1', 'user-1', { file: fileOf() })).rejects.toThrow(
			DocumentsNotAvailableError
		);
		expect(putPrivateObject).not.toHaveBeenCalled();
		expect(statements.some((s) => s.op === 'insert')).toBe(false);
	});

	it.each(['club', 'committee'])('allows a %s', async (kind) => {
		queueUploadReads({ kind });

		await expect(upload('group-1', 'user-1', { file: fileOf() })).resolves.toBeDefined();
	});

	it('throws when the group does not exist', async () => {
		selectQueue.push([]);

		await expect(upload('nope', 'user-1', { file: fileOf() })).rejects.toThrow(FileNotFoundError);
	});

	// ---- validation and quota ---------------------------------------------

	it('refuses a disallowed type without storing anything', async () => {
		selectQueue.push([{ kind: 'club' }]);

		await expect(
			upload('group-1', 'user-1', { file: fileOf({ type: 'application/zip' }) })
		).rejects.toThrow(InvalidDocumentError);
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('refuses a file over the per-file ceiling', async () => {
		selectQueue.push([{ kind: 'club' }]);

		await expect(
			upload('group-1', 'user-1', { file: fileOf({ size: 26 * 1024 * 1024 }) })
		).rejects.toThrow(/25MB/);
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('refuses a group already at its file count, however small the file', async () => {
		selectQueue.push([{ kind: 'club' }]);
		selectQueue.push([{ used: 1024, files: DOCUMENT_QUOTA_FILES }]);

		await expect(upload('group-1', 'user-1', { file: fileOf({ size: 1 }) })).rejects.toThrow(
			QuotaExceededError
		);
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('refuses a file that would take the group past its byte quota', async () => {
		selectQueue.push([{ kind: 'club' }]);
		selectQueue.push([{ used: DOCUMENT_QUOTA_BYTES - 1, files: 3 }]);

		await expect(upload('group-1', 'user-1', { file: fileOf({ size: 2 }) })).rejects.toThrow(
			QuotaExceededError
		);
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('accepts a file that exactly fills the remaining quota', async () => {
		queueUploadReads({ used: DOCUMENT_QUOTA_BYTES - 2048, files: 3 });

		await expect(
			upload('group-1', 'user-1', { file: fileOf({ size: 2048 }) })
		).resolves.toBeDefined();
	});
});

describe('remove', () => {
	it('soft-deletes, scoped to the group', async () => {
		returningQueue.push([{ id: 'file-1' }]);

		await remove('file-1', 'group-1');

		const update = statements.find((s) => s.op === 'update');
		expect(update?.values).toHaveProperty('deletedAt');
		const where = whereOf(statements.indexOf(update!));
		expect(where).toContain('"group_id" = ?');
	});

	/**
	 * The central deletion rule, and it needs a test that fails when someone
	 * "fixes" what looks like a leak by deleting inline. A delete from a request
	 * path cannot see whether anything else still needs the object, and if the R2
	 * call fails after the row is gone the file is stranded with no record of its
	 * key.
	 */
	it('touches no R2 object at all', async () => {
		returningQueue.push([{ id: 'file-1' }]);

		await remove('file-1', 'group-1');

		expect(deletePrivateObject).not.toHaveBeenCalled();
		expect(journal).not.toContain('deleteObject');
	});

	it("refuses another group's document", async () => {
		returningQueue.push([]);

		await expect(remove('file-1', 'group-2')).rejects.toThrow(FileNotFoundError);
	});
});

describe('the reaper reads', () => {
	it('listAllKeys includes soft-deleted rows, because the cascade is about to take them', async () => {
		selectQueue.push([{ id: 'file-1', key: 'k1' }]);

		await listAllKeys('group-1');

		const where = lastWhere();
		expect(where).toContain('"group_id" = ?');
		expect(where).not.toContain('deleted_at');
	});

	it('listSweepCandidates takes only rows removed before the cutoff', async () => {
		selectQueue.push([]);

		await listSweepCandidates(new Date('2026-08-01'));

		const where = lastWhere();
		expect(where).toContain('"deleted_at" is not null');
		expect(where).toContain('"deleted_at" < ?');
	});

	it('deleteRows chunks under D1 parameter cap', async () => {
		await deleteRows(Array.from({ length: 200 }, (_, i) => `f${i}`));

		expect(statements.filter((s) => s.op === 'delete')).toHaveLength(3);
	});

	it('deleteRows issues no statement for an empty list', async () => {
		await deleteRows([]);

		expect(statements).toHaveLength(0);
	});
});
