import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every remote that can hand out a door code is staff-only or holds the code
 * while the booker owes a fee (#2874). A reader is any exported query or
 * command whose body names a code or selects a whole reservation row. A
 * reader that returns neither is listed below with its reason.
 */

const DIR = join(process.cwd(), 'src/lib/remote');

const CODE_BEARING = [
	/\blockCode\b/,
	/\bfallbackCode\b/,
	/\brevealFallbackCodeFor\(/,
	/\bfallbackShownFor\(/,
	/\bgetActiveFallbackCode\(/,
	/\blistActiveCodes\(/,
	/\.select\(\)\s*\.from\(reservation\)/,
	/:\s*reservation\s*[,}]/
];
const STAFF_ONLY = /\brequireCapability\(/;
const HOLDS_CODE = /\bdoorCodeHeldSince\(/;

/** `file:export` → why its whole-row read never reaches the client. */
const RETURNS_NO_CODE: Record<string, string> = {
	'reservations.remote.ts:getReservationPayment': 'returns a picked subset; no code field',
	'users.remote.ts:getMemberDashboard': 'maps each week row to fields without the code'
};

type Reader = { key: string; body: string };

function readers(): Reader[] {
	const out: Reader[] = [];
	for (const file of readdirSync(DIR).filter((f) => f.endsWith('.remote.ts'))) {
		const source = readFileSync(join(DIR, file), 'utf8');
		// An export's body ends at the first `});` or `);` in column 0.
		for (const exported of source.split(/^export /m).slice(1)) {
			const end = /^\}?\);$/m.exec(exported);
			const chunk = end ? exported.slice(0, end.index) : exported;
			const head = /^const (\w+) = (query|command)\b/.exec(chunk);
			if (!head) continue;
			if (CODE_BEARING.some((re) => re.test(chunk))) {
				out.push({ key: `${file}:${head[1]}`, body: chunk });
			}
		}
	}
	return out;
}

describe('door code readers', () => {
	const found = readers();

	it('finds the known member readers, so the walk is not vacuous', () => {
		const keys = found.map((r) => r.key);
		expect(keys).toEqual(
			expect.arrayContaining([
				'reservations.remote.ts:getReservationDetail',
				'reservations.remote.ts:getBandReservationDetail',
				'reservations.remote.ts:getReservations',
				'lock.remote.ts:getLockHealth'
			])
		);
	});

	it('are staff-only or hold the code while a fee is owed', () => {
		const unguarded = found
			.filter((r) => !(r.key in RETURNS_NO_CODE))
			.filter((r) => !STAFF_ONLY.test(r.body) && !HOLDS_CODE.test(r.body))
			.map((r) => r.key);
		expect(unguarded).toEqual([]);
	});

	it('lists no allowance that has stopped matching', () => {
		const keys = new Set(found.map((r) => r.key));
		expect(Object.keys(RETURNS_NO_CODE).filter((k) => !keys.has(k))).toEqual([]);
	});
});
