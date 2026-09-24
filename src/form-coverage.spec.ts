import { describe, it, expect, vi } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { posix } from 'node:path';

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

/** The `.svelte` files a component imports, as repo-relative paths. */
function svelteImports(file: string, source: string): string[] {
	return [...source.matchAll(/from\s+['"]([^'"]+\.svelte)['"]/g)].map(([, spec]) =>
		spec.startsWith('$lib/')
			? posix.join('src/lib', spec.slice(5))
			: posix.join(posix.dirname(file), spec)
	);
}

/** The text of a form's hosts and of every component they import. */
function renderScope(hosts: string[], files: Map<string, string>): string {
	const paths = new Set(hosts.flatMap((h) => [h, ...svelteImports(h, files.get(h) ?? '')]));
	return [...paths].map((p) => files.get(p) ?? '').join('\n');
}

/**
 * Whether a host, or a component a host imports, declares
 * `${key}: RemoteFormField<…>`. Scoped so one field set cannot cover a field
 * of the same name on a form it never renders (#1499).
 */
function declaresFieldSet(key: string, hosts: string[], files: Map<string, string>): boolean {
	return new RegExp(`^\\s*${key}\\s*:\\s*RemoteFormField`, 'm').test(renderScope(hosts, files));
}

/** Every exported `form()`, by name, with its schema's keys. */
async function remoteForms() {
	const byName = new Map<string, string[]>();
	for (const m of globSync('src/lib/remote/*.remote.ts')) {
		const mod: Record<string, { __?: { type?: string; i?: number } }> = await import(
			/* @vite-ignore */ '/' + m
		);
		for (const [name, v] of Object.entries(mod)) {
			const i = v?.__?.i;
			if (v?.__?.type !== 'form' || typeof i !== 'number') continue;
			// `null` is what `query`/`command` push, so it marks a non-form.
			if (CAP[i] === null) continue;
			const schema = CAP[i] as { shape?: Record<string, unknown> };
			byName.set(name, Object.keys(schema?.shape ?? {}));
		}
	}
	return byName;
}

async function uncoveredFields() {
	const byName = await remoteForms();
	const files = new Map(
		globSync('src/{routes,lib/components}/**/*.svelte').map((p) => [p, readFileSync(p, 'utf8')])
	);

	const out: string[] = [];
	for (const [name, keys] of byName) {
		if (!keys.length) continue;
		const hosts = [...files.keys()].filter((p) => new RegExp(`\\b${name}\\b`).test(files.get(p)!));
		if (!hosts.length) continue;
		const scoped = hosts.map((p) => files.get(p)).join('\n');
		for (const k of keys) {
			if (CONTEXT.test(k)) continue;
			// A named control in a host or in a step component a host imports.
			if (new RegExp(`name="${k}"`).test(renderScope(hosts, files))) continue;
			// Any `<something>.${k}` in a file hosting this form. Loose on purpose:
			// field objects get aliased, passed as snippet parameters and spread into
			// child sets, and chasing every binding shape costs more than it catches.
			if (new RegExp(`\\.${k}\\b`).test(scoped)) continue;
			// A field set declaring `${k}: RemoteFormField<…>` renders it.
			if (declaresFieldSet(k, hosts, files)) continue;
			out.push(`${name}.${k}`);
		}
	}
	return out;
}

describe('the field-set escape hatch', () => {
	const files = new Map([
		['src/routes/a/+page.svelte', "import Fields from './Fields.svelte';\n<Fields />"],
		[
			'src/routes/a/Fields.svelte',
			'let { f }: {\n\taddress: RemoteFormField<string>;\n} = $props();'
		],
		[
			'src/routes/b/Other.svelte',
			'let { f }: {\n\twebsite: RemoteFormField<string>;\n} = $props();'
		]
	]);

	it('counts a field set the hosting page imports', () => {
		expect(declaresFieldSet('address', ['src/routes/a/+page.svelte'], files)).toBe(true);
	});

	it('ignores a field set declared by a component the host never imports', () => {
		expect(declaresFieldSet('website', ['src/routes/a/+page.svelte'], files)).toBe(false);
	});
});

describe('form field coverage', () => {
	// It reads every `form()` in the tree and every component that might render
	// one, so it runs near the 5s default on its own and tips over it whenever
	// a sibling file is competing for the machine. The budget is generous
	// rather than tuned: this is one assertion over a whole-tree scan.
	it('renders a control for every field its schema accepts', { timeout: 30_000 }, async () => {
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

	// Rendered by an open PR (#1526). Delete the entry once it lands.
	const HOSTLESS_IN_FLIGHT = new Set(['createWorkOrder']);

	// The field check above skips a form nothing names, so a whole form with no
	// page slipped past it (#1426, #1528).
	it('names every form() from some component', { timeout: 30_000 }, async () => {
		const svelte = globSync('src/{routes,lib/components}/**/*.svelte')
			.map((p) => readFileSync(p, 'utf8'))
			.join('\n');
		const hostless = [...(await remoteForms()).keys()].filter(
			(name) => !HOSTLESS_IN_FLIGHT.has(name) && !new RegExp(`\\b${name}\\b`).test(svelte)
		);

		expect(
			hostless,
			`No component names these forms, so no page can submit them. Render ` +
				`each one, or delete it:\n${hostless.map((f) => `  ${f}`).join('\n')}\n`
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
