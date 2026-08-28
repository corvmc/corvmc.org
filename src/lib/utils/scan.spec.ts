import { describe, it, expect } from 'vitest';
import { parseScan } from './scan';

/**
 * The camera is not tested here — a decode loop needs a real device and a real
 * barcode in front of it. What is testable, and what actually decides behaviour,
 * is telling one kind of scan from another: a tag lookup and a GTIN lookup read
 * different columns, so guessing wrong sends the caller to the wrong record.
 */
describe('parseScan', () => {
	it('unwraps the tag from the URL the QR encodes', () => {
		expect(parseScan('https://corvmc.org/a/CMC-000110')).toEqual({
			kind: 'tag',
			value: 'CMC-000110'
		});
	});

	/**
	 * Stickers outlive domains and schemes. The `/a/` path is what identifies one
	 * of ours; the host is not, so a tag printed before a move still scans.
	 */
	it('accepts any host, scheme, or a bare path', () => {
		for (const text of [
			'http://corvmc.org/a/CMC-000110',
			'https://www.corvmc.org/a/CMC-000110',
			'https://staging.example.com/a/CMC-000110',
			'/a/CMC-000110',
			'https://corvmc.org/a/CMC-000110/'
		]) {
			expect(parseScan(text), text).toEqual({ kind: 'tag', value: 'CMC-000110' });
		}
	});

	it('ignores a query string or fragment after the tag', () => {
		expect(parseScan('https://corvmc.org/a/CMC-000110?from=qr')).toEqual({
			kind: 'tag',
			value: 'CMC-000110'
		});
		expect(parseScan('https://corvmc.org/a/CMC-000110#top')).toEqual({
			kind: 'tag',
			value: 'CMC-000110'
		});
	});

	it('decodes a percent-encoded tag', () => {
		expect(parseScan('https://corvmc.org/a/CMC%20110')).toEqual({
			kind: 'tag',
			value: 'CMC 110'
		});
	});

	it('reads a manufacturer barcode at every length retail assigns', () => {
		for (const code of ['12345678', '012345678905', '4006381333931', '00012345600012']) {
			expect(parseScan(code), code).toEqual({ kind: 'gtin', value: code });
		}
	});

	/**
	 * A run of digits that is not a GTIN length is far likelier to be a serial
	 * number than a barcode. Calling it a GTIN would send a lookup at the wrong
	 * column and answer "no such item" for gear that is sitting right there.
	 */
	it('does not call an arbitrary digit run a barcode', () => {
		for (const code of ['1234', '1234567', '123456789', '123456789012345']) {
			expect(parseScan(code).kind, code).toBe('unknown');
		}
	});

	it('passes anything else through untouched, rather than guessing', () => {
		expect(parseScan('FEN-STR-2019-0041')).toEqual({
			kind: 'unknown',
			value: 'FEN-STR-2019-0041'
		});
		// A URL of ours, but not an asset one.
		expect(parseScan('https://corvmc.org/staff/inventory').kind).toBe('unknown');
	});

	it('trims surrounding whitespace, which some scanners append', () => {
		expect(parseScan('  012345678905\n')).toEqual({ kind: 'gtin', value: '012345678905' });
	});

	it('reports an empty scan rather than throwing', () => {
		expect(parseScan('   ')).toEqual({ kind: 'unknown', value: '' });
	});
});
