/**
 * `pnpm form-reachability [--json]`: the service options no `form()` or
 * `command()` passes (#2049). `scripts/form-reachability.spec.ts` is the gate;
 * this prints the whole report, grouped by service, for reading.
 */
import { appReport } from './lib/app-form-reachability';

const report = appReport();

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
