import { describe, it, expect } from 'vitest';
import {
	contentDispositionAttachment,
	documentKey,
	extensionForType,
	mediaKey,
	sanitizeFilename
} from './storage-keys';

describe('extensionForType', () => {
	it('maps every type the upload endpoints accept', () => {
		expect(extensionForType('image/jpeg')).toBe('jpg');
		expect(extensionForType('image/png')).toBe('png');
		expect(extensionForType('image/webp')).toBe('webp');
		expect(extensionForType('image/gif')).toBe('gif');
		expect(extensionForType('application/pdf')).toBe('pdf');
	});

	it('maps every document type the private bucket accepts', () => {
		expect(extensionForType('text/plain')).toBe('txt');
		expect(extensionForType('text/csv')).toBe('csv');
		expect(
			extensionForType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
		).toBe('docx');
		expect(
			extensionForType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
		).toBe('xlsx');
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

describe('documentKey', () => {
	it('keys on the row id, so two uploads of the same name never collide', () => {
		const a = documentKey('g1', 'file-a', 'application/pdf');
		const b = documentKey('g1', 'file-b', 'application/pdf');

		expect(a).toBe('groups/g1/documents/file-a.pdf');
		expect(b).toBe('groups/g1/documents/file-b.pdf');
		expect(a).not.toBe(b);
	});

	it('has no room for a filename at all', () => {
		// The signature takes ids, so a display name cannot leak into a key that
		// someone might then treat as guessable.
		expect(documentKey('g1', 'f1', 'text/csv')).toBe('groups/g1/documents/f1.csv');
	});
});

describe('sanitizeFilename', () => {
	it('strips CR and LF, which are header injection on the download', () => {
		expect(sanitizeFilename('bad\r\nSet-Cookie: x=1.pdf')).toBe('badSet-Cookie: x=1.pdf');
	});

	it('strips quotes and backslashes, which would escape the quoted parameter', () => {
		expect(sanitizeFilename('a"; filename="b.exe')).toBe('a; filename=b.exe');
	});

	it('flattens path separators', () => {
		expect(sanitizeFilename('../../etc/passwd')).toBe('..-..-etc-passwd');
	});

	it('caps the length', () => {
		expect(sanitizeFilename('a'.repeat(400))).toHaveLength(255);
	});

	it('never returns an empty name', () => {
		// `filename=""` is worse than a made-up name: some clients save it as the
		// URL's last segment, which here is a bare uuid.
		expect(sanitizeFilename('"""')).toBe('download');
		expect(sanitizeFilename('   ')).toBe('download');
	});
});

describe('contentDispositionAttachment', () => {
	it('forces a download', () => {
		expect(contentDispositionAttachment('minutes.pdf')).toBe('attachment; filename="minutes.pdf"');
	});

	it('cannot be escaped by a stored filename', () => {
		// The double sanitization exists for exactly this: a row poisoned by a
		// migration or a hand edit, not by the upload path.
		const header = contentDispositionAttachment('a"; filename="b.exe');

		expect(header.match(/filename="/g)).toHaveLength(1);
		expect(header).not.toContain('"b.exe');
	});

	it('carries no CR or LF through from the row', () => {
		const header = contentDispositionAttachment('bad\r\nSet-Cookie: x=1.pdf');
		expect(header).not.toMatch(/[\r\n]/);
	});
});
