import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * Kit throws `remote_form_multiple_elements` when a second `<form>` attaches
 * one remote form instance before the first lets go (#3334). On a navigation
 * the incoming page can attach before the outgoing one tears down. So a remote
 * form goes bare to `remote=` or `action=` at one site at most; every other
 * site takes its own instance with `.for(key)`. Props are not followed.
 */

/** Existing shared sites, each with the issue that keys them. */
const KNOWN: Record<string, string> = {
	'projects#setProjectStatusForm': '#3340',
	'marketing#updateAudience': '#3340',
	'inventory#checkoutLoanForm': '#3340',
	'sponsors#createSponsorship': '#3340',
	'event-photos#uploadEventPhotos': '#3340',
	'market#openMarketDayForm': '#3340',
	'productions#askForArtifact': '#3340',
	'volunteer#saveVolunteerInterests': '#3340',
	'reservations#confirmWaitlisted': '#3340',
	'productions#createShow': '#3340',
	'events#claimFreeTicket': '#3340',
	'events#purchaseTickets': '#3340',
	'marketing#subscribeToAudience': '#3340',
	'bands#setBandTier': '#3340'
};

const IMPORT = /import\s*{([^}]+)}\s*from\s*['"][^'"]*?([\w-]+)\.remote(?:\.js)?['"]/g;
const ATTACH = /\b(?:remote|action)=\{([^}]*)\}/g;

function bareSites(): Map<string, string[]> {
	const sites = new Map<string, string[]>();
	for (const file of globSync('src/**/*.svelte')) {
		if (file.endsWith('.test.svelte')) continue;
		const source = readFileSync(file, 'utf8');
		const local = new Map<string, string>();
		for (const [, names, mod] of source.matchAll(IMPORT)) {
			for (const spec of names.split(',')) {
				const [name, alias = name] = spec.trim().split(/\s+as\s+/);
				if (name) local.set(alias, `${mod}#${name}`);
			}
		}
		for (const [, expr] of source.matchAll(ATTACH)) {
			for (const [alias, key] of local) {
				const bare = new RegExp(`(?<![\\w$.])${alias}(?![\\w$]|\\s*[.(])`);
				if (bare.test(expr)) sites.set(key, [...(sites.get(key) ?? []), file]);
			}
		}
	}
	return sites;
}

describe('a remote form is attached bare at one site at most', () => {
	const sites = bareSites();

	it('reads the sites', () => {
		// A parser change that drops most of them would otherwise pass vacuously.
		expect(sites.size).toBeGreaterThan(200);
	});

	it('keys every other site with .for(key)', () => {
		const shared = [...sites].filter(([, files]) => files.length > 1);
		const unlisted = shared.filter(([key]) => !(key in KNOWN));
		expect(
			unlisted.map(([key, files]) => `${key}: ${files.join(', ')}`),
			'These remote forms are attached bare at more than one site. Give each extra site ' +
				'its own instance with `.for(key)`, reading its fields from that instance too.'
		).toEqual([]);

		const stale = Object.keys(KNOWN).filter((key) => (sites.get(key)?.length ?? 0) < 2);
		expect(stale, 'Keyed now; delete these from KNOWN.').toEqual([]);
	});
});
