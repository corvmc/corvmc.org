import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The public bucket, which the two cross-bucket copies reach through
 * `getBucket`. Mocked rather than initialized so the specs can tell which
 * bucket each half of a copy touched.
 */
const publicPut = vi.fn(async () => undefined);
const publicGet = vi.fn(async (_key: string) => null as unknown);
vi.mock('$lib/server/storage', () => ({
	getBucket: () => ({ put: publicPut, get: publicGet })
}));

import {
	initPrivateStorage,
	getPrivateBucket,
	putPrivateObject,
	getPrivateObject,
	deletePrivateObject,
	listPrivateObjects,
	copyToPrivate,
	copyFromPrivate,
	validatePrivateUpload,
	PRIVATE_ALLOWED_TYPES,
	MAX_DOCUMENT_BYTES
} from './private-storage';
import * as privateStorage from './private-storage';

/**
 * Nothing is mocked here. The module's whole surface is a bucket handle plus
 * pure policy, so a fake `R2Bucket` object exercises every line for real.
 */

const put = vi.fn(async () => undefined);
const get = vi.fn(async () => null);
const del = vi.fn(async () => undefined);
const list = vi.fn(async () => ({ objects: [], truncated: false }) as unknown);

const bucket = { put, get, delete: del, list } as unknown as R2Bucket;

function fileOf(type: string, size: number, name = 'doc'): File {
	// A File whose byte length would actually cost that much to allocate is not
	// worth building; only `.type`, `.size` and `.name` are read.
	return { type, size, name } as File;
}

beforeEach(() => {
	vi.clearAllMocks();
	initPrivateStorage(bucket);
});

describe('the module boundary', () => {
	/**
	 * The guardrail, and the reason this module exists apart from `storage.ts`:
	 * a private object must reach a person through a request that authorizes
	 * them, never through an address they could pass on. This fails the day
	 * someone adds `getPrivateUrl`, which is precisely when it matters.
	 */
	it('exports nothing that mints a URL', () => {
		const offenders = Object.keys(privateStorage).filter((name) => /url/i.test(name));
		expect(offenders).toEqual([]);
	});

	it('throws a message naming the missing init call when uninitialized', async () => {
		// A fresh module instance, since `initPrivateStorage` is module state.
		vi.resetModules();
		const fresh = await import('./private-storage');
		expect(() => fresh.getPrivateBucket()).toThrow(/initPrivateStorage/);
	});

	it('hands back the bucket it was initialized with', () => {
		expect(getPrivateBucket()).toBe(bucket);
	});
});

describe('putPrivateObject', () => {
	it('writes the body at the key with its content type, and returns the key', async () => {
		const body = new ArrayBuffer(8);

		const key = await putPrivateObject('groups/g1/documents/f1.pdf', body, 'application/pdf');

		expect(key).toBe('groups/g1/documents/f1.pdf');
		expect(put).toHaveBeenCalledWith('groups/g1/documents/f1.pdf', body, {
			httpMetadata: { contentType: 'application/pdf' }
		});
	});

	/**
	 * The ceiling is a fact about the 128 MB isolate the body passes through, so
	 * it is enforced here rather than only at the caller — every future consumer
	 * of this bucket inherits it whether or not it remembers to check.
	 */
	it('refuses a body over the ceiling without touching the bucket', async () => {
		const oversized = { byteLength: MAX_DOCUMENT_BYTES + 1 } as ArrayBuffer;

		await expect(putPrivateObject('k', oversized, 'application/pdf')).rejects.toThrow(/25MB/);
		expect(put).not.toHaveBeenCalled();
	});

	it('accepts a body exactly at the ceiling', async () => {
		const atLimit = { byteLength: MAX_DOCUMENT_BYTES } as ArrayBuffer;

		await putPrivateObject('k', atLimit, 'application/pdf');

		expect(put).toHaveBeenCalledOnce();
	});
});

describe('getPrivateObject and deletePrivateObject', () => {
	it('reads the key verbatim', async () => {
		await getPrivateObject('groups/g1/documents/f1.pdf');
		expect(get).toHaveBeenCalledWith('groups/g1/documents/f1.pdf');
	});

	it('deletes the key verbatim', async () => {
		await deletePrivateObject('groups/g1/documents/f1.pdf');
		expect(del).toHaveBeenCalledWith('groups/g1/documents/f1.pdf');
	});
});

describe('validatePrivateUpload', () => {
	it.each(PRIVATE_ALLOWED_TYPES)('accepts %s', (type) => {
		expect(validatePrivateUpload(fileOf(type, 1024))).toBeNull();
	});

	/**
	 * Named one by one rather than checked as "not in the list", because the
	 * hazard is a future paste-in of `ALLOWED_TYPES` or a well-meaning widening.
	 * `File.type` is browser-supplied and there is no virus scanning, so this
	 * list is the only thing between the bucket and an arbitrary binary.
	 */
	it.each([
		'application/msword',
		'application/vnd.ms-excel',
		'application/zip',
		'application/octet-stream',
		'text/html',
		''
	])('rejects %s', (type) => {
		expect(validatePrivateUpload(fileOf(type, 1024))).toMatch(/not allowed/);
	});

	it('rejects a file over the size ceiling, naming the limit', () => {
		const reason = validatePrivateUpload(fileOf('application/pdf', MAX_DOCUMENT_BYTES + 1));
		expect(reason).toMatch(/25MB/);
	});

	it('does not raise the 10MB cap the public bucket enforces', () => {
		// 10MB is `storage.ts`'s hard cap; documents deliberately go past it.
		expect(validatePrivateUpload(fileOf('application/pdf', 11 * 1024 * 1024))).toBeNull();
	});
});

describe('listPrivateObjects', () => {
	it('returns keys and upload times, and nothing else off the R2 object', async () => {
		const uploaded = new Date('2026-01-01T00:00:00Z');
		list.mockResolvedValueOnce({
			objects: [{ key: 'groups/g1/documents/f1.pdf', uploaded, size: 12, etag: 'e' }],
			truncated: false
		});

		const page = await listPrivateObjects('groups/');

		expect(page.objects).toEqual([{ key: 'groups/g1/documents/f1.pdf', uploaded }]);
		expect(page.cursor).toBeUndefined();
	});

	it('passes the prefix and cursor through to the bucket', async () => {
		await listPrivateObjects('groups/', 'c1');

		expect(list).toHaveBeenCalledWith({ prefix: 'groups/', cursor: 'c1', limit: 1000 });
	});

	/** A cursor on an untruncated page would make the caller loop forever. */
	it('returns a cursor only when the page is truncated', async () => {
		list.mockResolvedValueOnce({ objects: [], truncated: true, cursor: 'next' });
		expect((await listPrivateObjects('groups/')).cursor).toBe('next');

		list.mockResolvedValueOnce({ objects: [], truncated: false, cursor: 'stale' });
		expect((await listPrivateObjects('groups/')).cursor).toBeUndefined();
	});
});

/**
 * The two directions a moderation takedown and its appeal move bytes. Both
 * stream, and both return a key — never a URL, which is what the boundary test
 * above enforces for the module as a whole.
 */
describe('the cross-bucket copies', () => {
	const source = { body: new ReadableStream(), httpMetadata: { contentType: 'image/jpeg' } };

	it('reads the public bucket and writes the private one', async () => {
		publicGet.mockResolvedValueOnce(source);

		const key = await copyToPrivate('events/posters/e1.jpg', 'events/posters/withheld/e1-x.jpg');

		expect(publicGet).toHaveBeenCalledWith('events/posters/e1.jpg');
		expect(put).toHaveBeenCalledWith('events/posters/withheld/e1-x.jpg', source.body, {
			httpMetadata: source.httpMetadata
		});
		expect(key).toBe('events/posters/withheld/e1-x.jpg');
		// The source is never removed here: the caller deletes it only once the
		// database has stopped naming it.
		expect(del).not.toHaveBeenCalled();
	});

	it('reads the private bucket and writes the public one', async () => {
		get.mockResolvedValueOnce(source as never);

		const key = await copyFromPrivate(
			'events/posters/withheld/e1-x.jpg',
			'events/posters/e1-y.jpg'
		);

		expect(get).toHaveBeenCalledWith('events/posters/withheld/e1-x.jpg');
		expect(publicPut).toHaveBeenCalledWith('events/posters/e1-y.jpg', source.body, {
			httpMetadata: source.httpMetadata
		});
		expect(key).toBe('events/posters/e1-y.jpg');
		expect(del).not.toHaveBeenCalled();
	});

	it('writes nothing and returns null when the source is gone', async () => {
		publicGet.mockResolvedValueOnce(null);
		expect(await copyToPrivate('gone.jpg', 'events/posters/withheld/e1-x.jpg')).toBeNull();
		expect(put).not.toHaveBeenCalled();

		get.mockResolvedValueOnce(null as never);
		expect(await copyFromPrivate('gone.jpg', 'events/posters/e1-y.jpg')).toBeNull();
		expect(publicPut).not.toHaveBeenCalled();
	});

	/**
	 * A 25 MB object re-read into a 128 MB isolate to count its bytes is the one
	 * thing a copy must not do; the source was size-checked on its way into R2.
	 */
	it('streams the body rather than buffering it', async () => {
		const arrayBuffer = vi.fn();
		publicGet.mockResolvedValueOnce({ ...source, arrayBuffer });

		await copyToPrivate('events/posters/e1.jpg', 'events/posters/withheld/e1-x.jpg');

		expect(arrayBuffer).not.toHaveBeenCalled();
	});
});
