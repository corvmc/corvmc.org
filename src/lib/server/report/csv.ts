import { stringify } from 'csv-stringify/browser/esm/sync';

/**
 * CSV for a report download.
 *
 * The browser ESM build, not the Node one: it has no `node:stream` behind it,
 * which is what makes it usable in a Worker at all.
 *
 * **`escape_formulas` is forced on and is not an option.** Every report this
 * app would export is full of member-authored text — names, hour-log comments,
 * suggestion titles — and staff open these in Excel, where a cell beginning
 * `=`, `+`, `-` or `@` is executed as a formula rather than shown as text. That
 * is CSV injection, and it is the reason to take this dependency at all rather
 * than hand-rolling a `toCsv`: a hand-rolled one gets the quoting right and
 * this wrong. Neither `csv-stringify` nor PapaParse escapes it by default, so
 * exposing the flag would only give a call site the chance to forget it.
 */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
	return stringify(rows, { header: true, columns, escape_formulas: true });
}

/**
 * A CSV response with the filename the browser should save it under.
 *
 * `text/csv; charset=utf-8` plus a BOM: Excel on Windows reads a UTF-8 CSV as
 * the system codepage without one, which turns every accented member name into
 * mojibake in the file a funder receives.
 */
export function csvResponse(filename: string, csv: string): Response {
	return new Response(`\uFEFF${csv}`, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${filename}"`,
			// A report is a snapshot of live data; a cached one is a wrong one.
			'cache-control': 'no-store'
		}
	});
}
