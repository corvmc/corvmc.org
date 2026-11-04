import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * A browser select with no empty option submits its first entry, so an optional
 * id with no blank row cannot be left unset: every new project was owned by the
 * first committee (#2388). `FormField` cannot tell, since a remote field carries
 * no schema, so this walks the schemas that accept `''` and the selects over them.
 */
const OPTIONAL_ID =
	/(\w+):\s*(?:optionalId\b|z\.union\(\[z\.literal\(''\),\s*z\.(?:uuid|string)\()/g;
const SELECT_OVER_FIELD = /<(?:Field|FormField)\b(?=[^>]*type="select")[^>]*?>/gs;

const files = (dir: string, suffix: string) =>
	readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((f) => f.endsWith(suffix))
		.map((f) => join(dir, f));

const svelte = [...files('src/routes', '.svelte'), ...files('src/lib/components', '.svelte')];

function missingBlank(source: string, names: Set<string>) {
	const out: string[] = [];
	for (const [tag] of source.matchAll(SELECT_OVER_FIELD)) {
		const name = tag.match(/field=\{\w+\.(\w+)\}/)?.[1];
		if (!name || !names.has(name)) continue;
		if (/\bplaceholder=/.test(tag) || /value:\s*''/.test(tag)) continue;
		// `options={x}`: the list may be built above with its own blank row.
		const list = tag.match(/options=\{(\w+)\}/)?.[1];
		const built = list && source.match(new RegExp(`\\b${list}\\b\\s*=[^;]*?;`, 's'))?.[0];
		if (!built || !/value:\s*''/.test(built)) out.push(name);
	}
	return out;
}

describe('a select over an optional id can be left unset', () => {
	const remotes = files('src/lib/remote', '.remote.ts').filter((f) => !f.includes('.spec.'));

	it('reads the optional ids', () => {
		const declared = remotes.flatMap((f) =>
			[...readFileSync(f, 'utf8').matchAll(OPTIONAL_ID)].map((m) => m[1])
		);
		// A parser change that finds none would otherwise pass vacuously.
		expect(declared).toContain('groupId');
	});

	it('gives each one an empty option', () => {
		const offenders: string[] = [];
		for (const remote of remotes) {
			const names = new Set(
				[...readFileSync(remote, 'utf8').matchAll(OPTIONAL_ID)].map((m) => m[1])
			);
			if (names.size === 0) continue;
			const module = `$lib/remote/${basename(remote, '.ts')}`;
			for (const file of svelte) {
				const source = readFileSync(file, 'utf8');
				if (!source.includes(module)) continue;
				for (const name of missingBlank(source, names)) offenders.push(`${file}: ${name}`);
			}
		}
		expect(offenders, 'Give the select a `placeholder`, which renders the empty option').toEqual(
			[]
		);
	});
});
