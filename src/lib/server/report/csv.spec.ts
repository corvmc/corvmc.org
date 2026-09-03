import { describe, it, expect } from 'vitest';
import { toCsv, csvResponse } from './csv';

describe('toCsv', () => {
	it('writes a header row from the named columns, in order', () => {
		const csv = toCsv([{ b: 2, a: 1 }], ['a', 'b']);
		expect(csv.split('\n')[0]).toBe('a,b');
	});

	it('quotes a field containing a comma rather than splitting the row', () => {
		const csv = toCsv([{ name: 'Doe, Jane' }], ['name']);
		expect(csv).toContain('"Doe, Jane"');
		expect(csv.trim().split('\n')).toHaveLength(2);
	});

	// The reason this module takes a dependency instead of hand-rolling. Excel
	// executes a cell that begins with one of these, so a member-authored hour
	// log comment is a code path in a spreadsheet a funder opens.
	it.each(['=', '+', '-', '@'])('neutralises a cell starting with %s', (lead) => {
		const csv = toCsv([{ comment: `${lead}HYPERLINK("http://evil","click")` }], ['comment']);
		const cell = csv.split('\n')[1];

		// Whatever the library's chosen escape, the payload must not survive as
		// the first character of the cell value.
		expect(cell.replace(/^"/, '').startsWith(lead)).toBe(false);
		expect(cell).toContain('HYPERLINK');
	});

	it('escapes formulas even though nothing asked it to', () => {
		// There is no option to turn this off, on purpose: an opt-in that every
		// call site has to remember is one that some call site will not.
		expect(toCsv([{ x: '=1+1' }], ['x'])).not.toMatch(/\n=1\+1/);
	});

	it('emits only a header for no rows, rather than throwing', () => {
		expect(toCsv([], ['a', 'b']).trim()).toBe('a,b');
	});
});

describe('csvResponse', () => {
	it('names the download and marks it as an attachment', () => {
		const res = csvResponse('volunteer-hours.csv', 'a,b\n1,2');
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="volunteer-hours.csv"'
		);
		expect(res.headers.get('content-type')).toContain('text/csv');
	});

	it('leads with a UTF-8 BOM, so Excel on Windows does not mojibake a name', async () => {
		// Checked as bytes, not text: `Response.text()` decodes UTF-8 and strips
		// a leading BOM, so the string view cannot see the thing under test.
		const bytes = new Uint8Array(await csvResponse('x.csv', 'name\nJosé').arrayBuffer());
		expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
	});

	it('refuses caching, because a cached report is a stale one', () => {
		expect(csvResponse('x.csv', 'a').headers.get('cache-control')).toBe('no-store');
	});
});
