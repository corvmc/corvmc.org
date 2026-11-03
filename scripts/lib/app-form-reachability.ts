import ts from 'typescript';
import { relative } from 'node:path';
import { sourceFiles } from './source-files';
import { analyse, type Report } from './form-reachability';

/**
 * The form-reachability report over this app (#2049), shared by
 * `pnpm form-reachability` and the gate in `scripts/form-reachability.spec.ts`.
 * Needs `.svelte-kit/tsconfig.json`, which `svelte-kit sync` writes.
 */
export function appReport(root = process.cwd()): Report {
	const rel = (f: string) => relative(root, f).replaceAll('\\', '/');
	const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
	if (!configPath) throw new Error('no tsconfig.json; run `pnpm exec svelte-kit sync` first');
	const config = ts.getParsedCommandLineOfConfigFile(
		configPath,
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: (d) => {
				throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
			}
		}
	);
	if (!config) throw new Error(`could not read ${configPath}`);

	const remotes = sourceFiles(['src/lib/remote/*.remote.ts'], new Set()).map((f) => `${root}/${f}`);
	// Every root, not just the remotes: `app.d.ts` types `locals`.
	const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });

	return analyse(program, remotes, {
		isService: (f) => rel(f).startsWith('src/lib/server/') && !/\.spec\.ts$/.test(f),
		// A clock seam for tests, never a member-facing option.
		ignoreKeys: new Set(['now']),
		// Guards: their options scope a permission check, not a feature.
		ignoreFunction: (name) => name === 'can' || /^require[A-Z]/.test(name),
		label: rel
	});
}

/** One allowlist key per option: `file#fn(arg n).key`. */
export const optionKey = (u: { service: string; param: number; key: string }) =>
	`${u.service}(${u.param}).${u.key}`;
