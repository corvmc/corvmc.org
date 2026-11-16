import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { surfaces } from '#lib/config.js';
import { ALL_FLAGS, isFeatureEnabled, requireFeature } from './feature-flags';
import { DEFAULTS } from './site-config/site-config-service';

const ROOT = join(import.meta.dirname, '../../..');

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
		return /\.(ts|js|mjs|svelte)$/.test(entry.name) ? [path] : [];
	});
}

/** A site-config read or write of a `feature.*` key, through the service or KV directly. */
const FEATURE_READ =
	/(?:config|getSiteConfig|getConfigsByPrefix|updateSiteConfigs?)(?:<[^>]*>)?\(\s*['"`]feature\b|site-config:feature\b|key:\s*['"`]feature\./;

/**
 * Switches are code config since #3117: turning one on is a deploy. A KV-backed
 * `feature.*` key would bring back a runtime switch beside them, so none may be
 * registered, read or written.
 */
describe('feature switches', () => {
	afterEach(() => {
		for (const flag of ALL_FLAGS) surfaces[flag] = false;
	});

	it('registers no feature.* site-config key', () => {
		expect(Object.keys(DEFAULTS).filter((key) => key.startsWith('feature.'))).toEqual([]);
	});

	it('has no code reading a feature.* site-config key', () => {
		const self = relative(ROOT, import.meta.filename);
		const offenders = ['src', 'scripts', 'e2e']
			.flatMap((dir) => sourceFiles(join(ROOT, dir)))
			.filter((file) => relative(ROOT, file) !== self)
			.filter((file) => FEATURE_READ.test(readFileSync(file, 'utf8')))
			.map((file) => relative(ROOT, file));
		expect(offenders).toEqual([]);
	});

	it('gives every flag a switch in surfaces, so help frontmatter can name it', () => {
		expect(ALL_FLAGS.filter((flag) => !Object.hasOwn(surfaces, flag))).toEqual([]);
	});

	it('reads the switch at call time', async () => {
		await expect(requireFeature('bandAudio')).rejects.toMatchObject({ status: 404 });
		expect(await isFeatureEnabled('bandAudio')).toBe(false);

		surfaces.bandAudio = true;
		await expect(requireFeature('bandAudio')).resolves.toBeUndefined();
		expect(await isFeatureEnabled('bandAudio')).toBe(true);
	});
});
