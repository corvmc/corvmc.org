import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Source-text assertions, like `seed-typing.spec.ts` and for the same reason:
 * importing a seeder opens D1 at module scope. These cover the three ways the
 * persona roster silently stops covering what it claims to (#864).
 */
const seedDir = new URL('./', import.meta.url);
const sources = readdirSync(seedDir)
	.filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
	.map((name) => [name, readFileSync(new URL(name, seedDir), 'utf8')] as const);

const usagePersonas = readFileSync(new URL('usage-personas.ts', seedDir), 'utf8');
const config = readFileSync(new URL('../../src/lib/config.ts', seedDir), 'utf8');

/** The `positionLabels` keys, minus the two that are not narrowed positions. */
function namedPositions(): string[] {
	const block = config.match(/export const positionLabels = \{([\s\S]*?)\n\} as const;/)?.[1] ?? '';
	return [...block.matchAll(/^\t(\w+):/gm)]
		.map((m) => m[1])
		.filter((name) => name !== 'admin' && name !== 'staff');
}

describe('usage personas', () => {
	it('gives every named position an account that can sign in', () => {
		// A position role assigned to a bulk user is invisible: `seedUsers` writes
		// no `account` row, so the narrowing can only be read about, never seen.
		const missing = namedPositions().filter(
			(position) => !new RegExp(`'${position}'`).test(usagePersonas)
		);

		expect(
			missing,
			`These positions have no loginable persona in usage-personas.ts: ${missing.join(', ')}`
		).toEqual([]);
	});

	it('keeps every position persona off the broad staff role', () => {
		// `staff` holds all but three capabilities, so a persona carrying both
		// passes every guard for the wrong reason and falsifies nothing.
		const roleLists = [...usagePersonas.matchAll(/roles: \[([^\]]*)\] as const/g)].map((m) => m[1]);

		expect(roleLists.filter((list) => /'(staff|admin)'/.test(list))).toEqual([]);
	});

	it('leaves the styles that are not data out of the seed', () => {
		// Device, viewport and assistive technology are runtime properties. A
		// persona claiming one would be a fixture that cannot be true, and the
		// place for them is Playwright — see the quickstart.
		const styles = readFileSync(new URL('style-personas.ts', seedDir), 'utf8');
		const claimed = ['viewport', 'screenReader', 'userAgent', 'prefersReducedMotion'].filter(
			(field) => new RegExp(`\\b${field}\\b`).test(styles)
		);

		expect(claimed, `${claimed.join(', ')} cannot be seeded — see the quickstart`).toEqual([]);
	});

	it('allocates member numbers no other seeder has taken', () => {
		// UNIQUE, and a reuse takes the whole seed down on an error that names the
		// column and not the two files fighting over it.
		const seen = new Map<number, string>();
		const collisions: string[] = [];
		for (const [name, source] of sources) {
			// Literal assignments only — `seedUsers` computes its own as `100 + i`.
			for (const match of source.matchAll(/memberNumber: (\d+)[,\n]/g)) {
				const number = Number(match[1]);
				const owner = seen.get(number);
				if (owner) collisions.push(`${number}: ${owner} and ${name}`);
				else seen.set(number, name);
			}
		}

		expect(collisions).toEqual([]);
		// `seedUsers` takes 100 + i for its bulk members, and nothing else may.
		expect([...seen.keys()].filter((n) => n >= 100 && n < 200)).toEqual([]);
	});
});
