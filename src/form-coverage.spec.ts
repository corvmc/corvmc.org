import { describe, it, expect, vi } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * Every field a `form()` accepts must be reachable from a control. A schema key
 * nothing renders is a capability that is not shipped — #1109, #1119.
 *
 * The schema side is exact: `form()` is mocked to capture the real Zod object,
 * so this never guesses a name. The UI side is a text search, which is why
 * `form-coverage.json` exists.
 */

const CAP: unknown[] = [];
const stub = () => {
	const i = CAP.length - 1;
	const fn = () => {};
	Object.assign(fn, {
		__: { type: 'form', i },
		for: () => fn,
		fields: new Proxy({}, { get: () => () => ({}) })
	});
	return fn;
};
const noop = () => {
	CAP.push(null);
	return stub();
};
vi.mock('$app/server', () => ({
	form: (schema: unknown) => {
		CAP.push(schema);
		return stub();
	},
	query: Object.assign(noop, { batch: noop }),
	command: noop,
	prerender: noop,
	getRequestEvent: () => ({
		locals: {},
		url: new URL('http://x/'),
		request: new Request('http://x/')
	})
}));

/** Supplied by the guard or the page, never typed by a person. */
const CONTEXT = /^(id|.*Id|.*Ids|slug|token|intent|turnstileToken)$/;

const GRANDFATHERED: string[] = JSON.parse(readFileSync('src/form-coverage.json', 'utf8'));

async function uncoveredFields() {
	const byName = new Map<string, string[]>();
	for (const m of globSync('src/lib/remote/*.remote.ts')) {
		const mod: Record<string, { __?: { type?: string; i?: number } }> = await import(
			/* @vite-ignore */ '/' + m
		);
		for (const [name, v] of Object.entries(mod)) {
			const i = v?.__?.i;
			if (v?.__?.type !== 'form' || typeof i !== 'number') continue;
			const schema = CAP[i] as { shape?: Record<string, unknown> } | null;
			const keys = Object.keys(schema?.shape ?? {});
			if (keys.length) byName.set(name, keys);
		}
	}

	const svelte = globSync('src/{routes,lib/components}/**/*.svelte').map((p) =>
		readFileSync(p, 'utf8')
	);
	const all = svelte.join('\n');

	const out: string[] = [];
	for (const [name, keys] of byName) {
		const hosts = svelte.filter((s) => new RegExp(`\\b${name}\\b`).test(s));
		if (!hosts.length) continue;
		const scoped = hosts.join('\n');
		for (const k of keys) {
			if (CONTEXT.test(k)) continue;
			if (new RegExp(`name="${k}"`).test(scoped)) continue;
			// Any `<something>.${k}` in a file hosting this form. Loose on purpose:
			// field objects get aliased, passed as snippet parameters and spread into
			// child sets, and chasing every binding shape costs more than it catches.
			if (new RegExp(`\\.${k}\\b`).test(scoped)) continue;
			// A field set declaring `${k}: RemoteFormField<…>` renders it.
			if (new RegExp(`^\\s*${k}\\s*:\\s*RemoteFormField`, 'm').test(all)) continue;
			out.push(`${name}.${k}`);
		}
	}
	return out;
}

describe('form field coverage', () => {
	it('renders a control for every field its schema accepts', async () => {
		const grandfathered = new Set(GRANDFATHERED);
		const offenders = (await uncoveredFields()).filter((f) => !grandfathered.has(f));

		expect(
			offenders,
			`These form fields are accepted by a schema and rendered by no control, so ` +
				`nobody can set them. Add the control, drop the field, or — if the control ` +
				`exists and this could not see it — add the entry to src/form-coverage.json ` +
				`with a note on the PR:\n${offenders.map((f) => `  ${f}`).join('\n')}\n`
		).toEqual([]);
	});

	it('drops an entry from the list once it is covered', async () => {
		const uncovered = new Set(await uncoveredFields());
		const stale = GRANDFATHERED.filter((f) => !uncovered.has(f));

		expect(
			stale,
			`These are covered now. Delete them from src/form-coverage.json, so the next ` +
				`change cannot spend what this one freed:\n${stale.map((f) => `  ${f}`).join('\n')}\n`
		).toEqual([]);
	});
});
