import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A reservation's state on screen comes from `reservationTrack` and
 * `trackDetail` in `reservation-actions` (#2861). A component that decides on
 * `paidAt`, `refundedAt` or `cashDueCents` itself is a second definition of
 * that state. It may still print a column, and may guard a print behind a
 * track it already read.
 */
const COLUMN = /\.(paidAt|refundedAt|cashDueCents)\b/;
/** Defaults for printing are not decisions. */
const DEFAULTED = /\?\?\s*(null|0|'')/g;
const DECIDES = /\{#if|\{:else if|&&|\|\||[!=]==?|\s[<>]=?\s|!\w|\?/;
const READS_TRACK = /\btrack(Detail)?\b/i;

/** A status badge fed the stored status shows `completed`, which is not a track. */
const STORED_STATUS_BADGE = /<StatusBadge[^>]*(status=\{(r|res|reservation)\.status\}|\{status\})/;

const ALLOWED = new Set([
	// Checkout arithmetic: whether credits were committed, and what remains to charge.
	'src/routes/member/reservations/[id]/pay/+page.svelte'
]);

const RESERVATION_SURFACE =
	/\/reservations\/|\/panels\/SpacePanel\.svelte$|^src\/routes\/staff\/\+page\.svelte$/;

const files = sourceFiles(['src/**/*.svelte'], ALLOWED).filter((f) => RESERVATION_SURFACE.test(f));

function hits(test: (line: string) => boolean): string[] {
	const found: string[] = [];
	for (const file of files) {
		readFileSync(file, 'utf8')
			.split('\n')
			.forEach((line, i) => {
				if (test(line)) found.push(`${file}:${i + 1}  ${line.trim()}`);
			});
	}
	return found;
}

export function decidesOnColumn(line: string): boolean {
	if (!COLUMN.test(line) || READS_TRACK.test(line)) return false;
	return DECIDES.test(line.replace(DEFAULTED, ''));
}

describe('reservation components read the track', () => {
	it('finds the reservation components', () => {
		expect(files.length).toBeGreaterThan(10);
		expect(files).toContain('src/routes/staff/reservations/ReservationList.svelte');
		expect(files).toContain('src/routes/member/reservations/ReservationCard.svelte');
	});

	it('catches the shapes it replaced and passes a print', () => {
		for (const decided of [
			'{#if reservation.refundedAt}',
			'{:else if res.paidAt}',
			'{#if (res.cashDueCents ?? 0) > 0}',
			'const settled = match === null || match.paidAt !== null;',
			'{#if r.cashDueCents && !r.paidAt}'
		])
			expect(decidesOnColumn(decided), decided).toBe(true);
		for (const printed of [
			'formatCents: formatCents(r.cashDueCents ?? 0)',
			'paidAt: reservation.paidAt ?? null,',
			"{#if track === 'paid' && reservation.paidAt}"
		])
			expect(decidesOnColumn(printed), printed).toBe(false);
	});

	it('none decides payment state from the columns', () => {
		const found = hits(decidesOnColumn);
		expect(
			found,
			`read reservationTrack / trackDetail from $lib/utils/reservation-actions:\n${found.join('\n')}`
		).toEqual([]);
	});

	it('none hands a stored status to StatusBadge', () => {
		const found = hits((line) => STORED_STATUS_BADGE.test(line));
		expect(found, `pass the track:\n${found.join('\n')}`).toEqual([]);
	});
});
