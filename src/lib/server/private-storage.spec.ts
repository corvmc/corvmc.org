import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	initPrivateStorage,
	getPrivateBucket,
	putPrivateObject,
	getPrivateObject,
	deletePrivateObject,
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

const bucket = { put, get, delete: del } as unknown as R2Bucket;

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
