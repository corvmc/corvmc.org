import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every notification links somewhere, and nothing else checks that the somewhere
 * exists. `/member/tickets` shipped in the event-cancellation notification and
 * 404'd for every recipient (#894): the href is a bare string on the server, so
 * neither `resolve()` nor svelte-check ever sees it.
 */

const listeners = ['./notification-listeners.ts', '../event-bus/register-listeners.ts'].map((rel) =>
	fileURLToPath(new URL(rel, import.meta.url))
);
const routes = fileURLToPath(new URL('../../../routes', import.meta.url));

/** Every `href:` a listener dispatches, literal or interpolated, query stripped. */
function declaredHrefs(): string[] {
	return listeners.flatMap((file) =>
		[...readFileSync(file, 'utf8').matchAll(/href:\s*[`'"]([^`'"]+)[`'"]/g)].map(
			(m) => m[1].split('?')[0]
		)
	);
}

/**
 * Walk `src/routes` the way the router would. An interpolated segment matches
 * whatever `[param]` directory sits at that depth, which is the only shape the
 * listeners build.
 */
function routeExists(href: string): boolean {
	let dir = routes;
	for (const segment of href.split('/').filter(Boolean)) {
		const interpolated = segment.includes('${');
		if (!interpolated && existsSync(`${dir}/${segment}`)) {
			dir = `${dir}/${segment}`;
			continue;
		}
		const param = interpolated && readdirSync(dir).find((entry) => entry.startsWith('['));
		if (!param) return false;
		dir = `${dir}/${param}`;
	}
	return existsSync(`${dir}/+page.svelte`);
}

describe('notification hrefs', () => {
	it('finds some to check', () => {
		expect(declaredHrefs().length).toBeGreaterThan(20);
	});

	it.each(declaredHrefs())('%s is a real page', (href) => {
		expect(routeExists(href)).toBe(true);
	});
});
