import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env vars
vi.mock('$env/dynamic/private', () => ({
	env: {
		R2_PUBLIC_URL: 'https://pub.example.com',
		R2_TRANSFORM_URL: ''
	}
}));

import {
	initStorage,
	uploadFile,
	deleteObject,
	getPublicUrl,
	isConfigured,
	validateUpload,
	MAX_SIZE_BYTES
} from './storage';
import { env } from '$env/dynamic/private';

const mockBucket = {
	put: vi.fn().mockResolvedValue({}),
	delete: vi.fn().mockResolvedValue(undefined),
	get: vi.fn(),
	list: vi.fn(),
	head: vi.fn(),
	createMultipartUpload: vi.fn()
};

describe('storage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		initStorage(mockBucket as unknown as R2Bucket);
	});

	describe('uploadFile', () => {
		it('uploads a valid JPEG file', async () => {
			const buffer = new ArrayBuffer(1024);
			const key = await uploadFile(buffer, 'test/img.jpg', 'image/jpeg');

			expect(key).toBe('test/img.jpg');
			expect(mockBucket.put).toHaveBeenCalledWith('test/img.jpg', buffer, {
				httpMetadata: { contentType: 'image/jpeg' }
			});
		});

		it('uploads a valid PNG file', async () => {
			const buffer = new ArrayBuffer(2048);
			const key = await uploadFile(buffer, 'test/img.png', 'image/png');
			expect(key).toBe('test/img.png');
		});

		it('uploads a valid WebP file', async () => {
			const buffer = new ArrayBuffer(512);
			const key = await uploadFile(buffer, 'test/img.webp', 'image/webp');
			expect(key).toBe('test/img.webp');
		});

		it('rejects disallowed content types', async () => {
			const buffer = new ArrayBuffer(100);

			await expect(uploadFile(buffer, 'test.pdf', 'application/pdf')).rejects.toThrow(
				'not allowed'
			);
			expect(mockBucket.put).not.toHaveBeenCalled();
		});

		it('rejects files over 10MB', async () => {
			const buffer = new ArrayBuffer(11 * 1024 * 1024);

			await expect(uploadFile(buffer, 'big.jpg', 'image/jpeg')).rejects.toThrow(
				'exceeds the 10MB limit'
			);
			expect(mockBucket.put).not.toHaveBeenCalled();
		});

		it('accepts files exactly at 10MB', async () => {
			const buffer = new ArrayBuffer(MAX_SIZE_BYTES);
			await expect(uploadFile(buffer, 'max.jpg', 'image/jpeg')).resolves.toBe('max.jpg');
		});
	});

	describe('validateUpload', () => {
		function fakeFile(type: string, size: number): File {
			return { type, size } as File;
		}

		it('returns null for a valid file', () => {
			expect(validateUpload(fakeFile('image/jpeg', 1024))).toBeNull();
		});

		it('returns a reason for a disallowed type', () => {
			expect(validateUpload(fakeFile('application/pdf', 1024))).toMatch(/not allowed/);
		});

		it('returns a reason naming the limit for oversized files', () => {
			const reason = validateUpload(fakeFile('image/png', MAX_SIZE_BYTES + 1));
			expect(reason).toMatch(/exceeds the 10MB limit/);
		});

		it('accepts a file exactly at the limit', () => {
			expect(validateUpload(fakeFile('image/webp', MAX_SIZE_BYTES))).toBeNull();
		});
	});

	describe('deleteObject', () => {
		it('calls delete on the bucket', async () => {
			await deleteObject('test/img.jpg');
			expect(mockBucket.delete).toHaveBeenCalledWith('test/img.jpg');
		});
	});

	describe('getPublicUrl', () => {
		it('returns direct URL when R2_TRANSFORM_URL is not set', () => {
			const url = getPublicUrl('events/posters/evt-1.jpg');
			expect(url).toBe('https://pub.example.com/events/posters/evt-1.jpg');
		});

		it('returns transform URL when R2_TRANSFORM_URL is set', () => {
			(env as any).R2_TRANSFORM_URL = 'https://img.example.com/cdn-cgi/image';

			const url = getPublicUrl('events/posters/evt-1.jpg');
			expect(url).toBe(
				'https://img.example.com/cdn-cgi/image/width=1200,fit=scale-down,format=auto,quality=85/events/posters/evt-1.jpg'
			);

			(env as any).R2_TRANSFORM_URL = '';
		});

		it('does not wrap a non-image key in a transform URL', () => {
			(env as any).R2_TRANSFORM_URL = 'https://img.example.com/cdn-cgi/image';

			// Rider/stage-plot uploads may be PDFs; running one through an image
			// transformation produces a broken URL.
			expect(getPublicUrl('bands/b1/media/rider/x.pdf')).toBe(
				'https://pub.example.com/bands/b1/media/rider/x.pdf'
			);

			(env as any).R2_TRANSFORM_URL = '';
		});

		it('does not wrap a key with no extension', () => {
			(env as any).R2_TRANSFORM_URL = 'https://img.example.com/cdn-cgi/image';
			expect(getPublicUrl('legacy/no-extension')).toBe(
				'https://pub.example.com/legacy/no-extension'
			);
			(env as any).R2_TRANSFORM_URL = '';
		});

		it('wraps a gif, which the band media endpoint accepts', () => {
			(env as any).R2_TRANSFORM_URL = 'https://img.example.com/cdn-cgi/image';
			expect(getPublicUrl('bands/b1/media/image/a.gif')).toContain('/cdn-cgi/');
			(env as any).R2_TRANSFORM_URL = '';
		});

		it('does not double-prefix an already-resolved URL', () => {
			const full = 'https://media.corvmc.org/46/01K7W8TMZGMCBKW803NR9TAAKR.jpg';
			expect(getPublicUrl(full)).toBe(full);
		});
	});

	describe('isConfigured', () => {
		it('returns true when bucket is initialized', () => {
			expect(isConfigured()).toBe(true);
		});
	});
});
