import { describe, it, expect } from 'vitest';
import { extensionForType, mediaKey } from './storage-keys';

describe('extensionForType', () => {
	it('maps every type the upload endpoints accept', () => {
		expect(extensionForType('image/jpeg')).toBe('jpg');
		expect(extensionForType('image/png')).toBe('png');
		expect(extensionForType('image/webp')).toBe('webp');
		expect(extensionForType('image/gif')).toBe('gif');
		expect(extensionForType('application/pdf')).toBe('pdf');
	});

	it('falls back to a non-transformable extension for unknown types', () => {
		expect(extensionForType('application/octet-stream')).toBe('bin');
	});
});

describe('mediaKey', () => {
	it('places the extension last so key parsing still works', () => {
		expect(mediaKey('users/avatars', 'u1', 'image/png')).toMatch(
			/^users\/avatars\/u1-[0-9a-f]{8}\.png$/
		);
	});

	it('produces a fresh key each call so replacing an image busts the cache', () => {
		const a = mediaKey('users/avatars', 'u1', 'image/jpeg');
		const b = mediaKey('users/avatars', 'u1', 'image/jpeg');
		expect(a).not.toBe(b);
	});
});
