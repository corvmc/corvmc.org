import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { billableHours } from './reservation-credit-service';

/**
 * #2568: a new member's reservation holds the room for a tour before the time
 * they asked for, and the tour is not charged. A price or free-hours figure
 * read off a stored window has to subtract it, so every `x.endsAt - x.startsAt`
 * in the remotes and the reservation domain must name `x.tourMinutes` too.
 */

const ROOTS = ['src/lib/remote', 'src/lib/server/reservation'];
const WINDOW = /(\w+(?:\.\w+)*)\.endsAt\.getTime\(\)\s*-\s*\1\.startsAt\.getTime\(\)([^;]*)/g;

function sources(): string[] {
	return ROOTS.flatMap((root) =>
		readdirSync(root, { recursive: true, encoding: 'utf8' })
			.filter((f) => f.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(f))
			.map((f) => join(root, f))
	);
}

describe('billable hours', () => {
	it('subtracts the tour from the window', () => {
		const startsAt = new Date('2026-07-17T18:30:00Z');
		const endsAt = new Date('2026-07-17T20:00:00Z');
		expect(billableHours({ startsAt, endsAt, tourMinutes: 30 })).toBe(1);
		expect(billableHours({ startsAt, endsAt, tourMinutes: 0 })).toBe(1.5);
	});

	it('is the only way a stored window becomes hours', () => {
		const offenders: string[] = [];
		for (const file of sources()) {
			for (const match of readFileSync(file, 'utf8').matchAll(WINDOW)) {
				const [, row, rest] = match;
				if (!rest.includes(`${row}.tourMinutes`)) offenders.push(`${file}: ${match[0]}`);
			}
		}
		expect(offenders, 'use billableHours(row) for a reservation row').toEqual([]);
	});
});
