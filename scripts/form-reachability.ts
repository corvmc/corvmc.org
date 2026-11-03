/**
 * `pnpm form-reachability [--json]`: the service options no `form()` or
 * `command()` passes (#2049). A report, not a gate: a service may keep an
 * option on purpose that only a job, a seed or another service sets, so the
 * output needs a human to read it.
 */
import ts from 'typescript';
import { relative } from 'node:path';
import { sourceFiles } from './lib/source-files';
import { analyse } from './lib/form-reachability';

const root = process.cwd();
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

const report = analyse(program, remotes, {
	isService: (f) => rel(f).startsWith('src/lib/server/') && !/\.spec\.ts$/.test(f),
	// A clock seam for tests, never a member-facing option.
	ignoreKeys: new Set(['now']),
	// Guards: their options scope a permission check, not a feature.
	ignoreFunction: (name) => name === 'can' || /^require[A-Z]/.test(name),
	label: rel
});

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(report, null, '\t'));
} else {
	const byService = Map.groupBy(report.unreached, (u) => `${u.service} (arg ${u.param})`);
	console.log(`# Service options no form() or command() passes\n`);
	console.log(`${report.remotes} remotes read, ${byService.size} service parameters with a gap.\n`);
	for (const [service, rows] of byService) {
		console.log(`## ${service}\n`);
		console.log(`- unreached: ${rows.map((r) => `\`${r.key}\``).join(', ')}`);
		console.log(`- called by: ${rows[0].callers.join(', ')}\n`);
	}
	console.log(`## Skipped: \`form('unchecked')\`\n`);
	for (const r of report.unchecked) console.log(`- ${r}`);
	console.log(`\n## No service call found in the handler\n`);
	for (const r of report.noServiceCall) console.log(`- ${r}`);
}
