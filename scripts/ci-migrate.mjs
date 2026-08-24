// Apply pending D1 migrations to remote, but ONLY for a build that publishes to production.
// Runs inside the Cloudflare Workers Builds build command (`pnpm ci:migrate && pnpm build`)
// so the schema is applied before the new Worker is published — and so preview/PR builds
// never touch the production database.
//
// Requires CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_DATABASE_ID / CLOUDFLARE_D1_TOKEN in the
// build environment (used by drizzle.config.ts's d1-http driver).
import { execFileSync } from 'node:child_process';

const PROD_BRANCH = 'main';
// GitHub's merge queue builds each entry on a temporary branch named
// `gh-readonly-queue/<base>/pr-<n>-<sha>`, and Cloudflare builds *that* branch and publishes
// it to production. It does not build again when the queue fast-forwards `main` onto the
// identical SHA, so this is the only build a queued PR ever gets: treating it as anything
// other than production ships the code and skips its migrations. Scoped to the queue for
// `main` specifically — a queue on another base is not production.
const PROD_QUEUE_PREFIX = `gh-readonly-queue/${PROD_BRANCH}/`;

/** Does a build on this branch publish to production, and so need the schema applied first? */
export function isProductionBranch(branch) {
	return branch === PROD_BRANCH || branch.startsWith(PROD_QUEUE_PREFIX);
}

function main() {
	// Workers Builds exposes the branch as WORKERS_CI_BRANCH; older Pages builds use CF_PAGES_BRANCH.
	const branch = process.env.WORKERS_CI_BRANCH ?? process.env.CF_PAGES_BRANCH ?? '';

	if (!isProductionBranch(branch)) {
		console.log(
			`ci:migrate — branch "${branch || '(unknown)'}" is neither "${PROD_BRANCH}" nor a "${PROD_QUEUE_PREFIX}*" merge queue branch, skipping remote migrate.`
		);
		process.exit(0);
	}

	const kind = branch === PROD_BRANCH ? 'production branch' : 'production merge queue';
	console.log(`ci:migrate — applying D1 migrations to remote (${kind}, branch "${branch}")…`);
	execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], { stdio: 'inherit' });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
