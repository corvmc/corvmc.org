import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A job is held as a seat in Operations (#2992); only `admin` is still a
 * `model_has_roles` row. A new read of the role tables that treats a row as a
 * position misses every job holder, so code under `src/` touches those tables
 * only in the files below, each of which reads the seats too. A seed or a
 * fixture writes legacy rows and is not listed.
 */
const ALLOWED: Record<string, string> = {
	'src/lib/server/authorization.ts': 'the resolver: positionsFor, getUserRoles and friends',
	'src/lib/server/access/position-service.ts': 'writes admin rows; jobs go to operations-service',
	'src/lib/server/access/access-service.ts': 'admin holders beside seat holders',
	'src/lib/server/user/user-totals-service.ts': 'the staff filter: admin rows or a seat',
	'src/lib/remote/users.remote.ts': 'the profile picker, which edits non-job rows only',
	'src/lib/server/db/schema/authorization.ts': 'the tables',
	'src/lib/server/db/schema/relations.ts': 'the relations'
};

const ROLE_TABLES = /\bmodelHasRole\b|\bmodel_has_roles\b/;

describe('position assignment is read through the resolver', () => {
	it('finds the role tables nowhere else in src', () => {
		const offenders = sourceFiles(['src/**/*.ts', 'src/**/*.svelte'], new Set())
			.filter((f) => !/\.(spec|test)\.ts$/.test(f))
			.filter((f) => !(f in ALLOWED) && f !== 'src/lib/config.ts')
			.filter((f) => ROLE_TABLES.test(readFileSync(f, 'utf8')));
		expect(offenders).toEqual([]);
	});

	it('lists no file that has stopped touching them', () => {
		const stale = Object.keys(ALLOWED).filter((f) => !ROLE_TABLES.test(readFileSync(f, 'utf8')));
		expect(stale).toEqual([]);
	});
});
