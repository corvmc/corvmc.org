// The "What failed" block of the merge queue guard's rejection comment.
//
// `.github/workflows/merge-queue-guard.yml` pipes every annotation of every failed job in
// here as one JSON array on stdin and appends what comes back. It is a file rather than more
// shell because CI YAML cannot be exercised by pushing: the only way to know what a rejection
// comment will say is to render a real payload, which `queue-guard-failures.spec.ts` does.

/**
 * One entry of GitHub's check-run annotations API.
 *
 * @typedef {object} Annotation
 * @property {string | null} [path]
 * @property {number | null} [start_line]
 * @property {string | null} [annotation_level]
 * @property {string | null} [title]
 * @property {string | null} [message]
 */

/**
 * Annotations that name nothing: the runner's own exit-code line, and the timeout notice the
 * `timeout` comment already quotes in its heading.
 */
const NOISE = [/Process completed with exit code/, /exceeded the maximum execution time/];

/**
 * A refused or dropped connection is a failure of the thing under test to exist, not of the
 * spec that noticed. `net::ERR_CONNECTION_REFUSED` is what Playwright reports when the preview
 * server is not listening.
 */
const CONNECTION_ERROR =
	/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ECONNREFUSED|ECONNRESET|socket hang up/;

/**
 * The first line of an annotation message. The rest is a stack, a call log and a code frame.
 *
 * @param {Annotation} annotation
 */
function headline(annotation) {
	return (annotation.message ?? '').split('\n')[0].trim();
}

/**
 * @param {Annotation[]} annotations
 * @returns {Annotation[]} the failures worth naming
 */
function namedFailures(annotations) {
	return annotations.filter((annotation) => {
		if (annotation.annotation_level !== 'failure') return false;
		const line = headline(annotation);
		return line !== '' && !NOISE.some((pattern) => pattern.test(line));
	});
}

/**
 * The failing specs, one markdown list item each.
 *
 * Deduplicated: Playwright annotates every retry of a failure, so a flaky spec that ran three
 * times arrives three times and would pad the list with copies of itself.
 *
 * @param {Annotation[]} annotations
 */
export function failureItems(annotations) {
	/** @type {string[]} */
	const items = [];
	const seen = new Set();

	for (const annotation of namedFailures(annotations)) {
		const item = `- \`${annotation.path ?? '?'}:${annotation.start_line ?? 0}\` — ${headline(annotation)}`;
		if (seen.has(item)) continue;
		seen.add(item);
		items.push(item);
	}

	return items;
}

/**
 * How many failures the run itself counted, or `null` if nothing said.
 *
 * Playwright's `github` reporter emits its run summary as a *notice* on path `.github`, whose
 * first line is `  250 failed`. Keeping only failure-level annotations threw that away, which
 * is how a 250-failure collapse was reported as the four specs Playwright happened to number
 * first (#794).
 *
 * @param {Annotation[]} annotations
 */
export function reportedFailureCount(annotations) {
	/** @type {number | null} */
	let total = null;

	for (const annotation of annotations) {
		for (const line of (annotation.message ?? '').split('\n')) {
			const match = /^\s*(\d+) failed\s*$/.exec(line);
			if (match) total = Math.max(total ?? 0, Number(match[1]));
		}
	}

	return total;
}

/**
 * The degenerate case: every annotated failure is a connection error, so nothing under test was
 * listening and the spec names are an artifact of test order. Two are required, so one test
 * reaching an unreachable third party does not read as a suite-wide collapse.
 *
 * @param {Annotation[]} annotations
 * @returns {{ origin: string | null } | null}
 */
export function connectionCollapse(annotations) {
	const failures = namedFailures(annotations);
	if (failures.length < 2) return null;
	if (!failures.every((annotation) => CONNECTION_ERROR.test(annotation.message ?? ''))) return null;

	const origin = /https?:\/\/[^/\s"'`]+/.exec(failures[0].message ?? '');
	return { origin: origin?.[0] ?? null };
}

/**
 * The whole section, heading included, or `''` when there is nothing to say.
 *
 * @param {Annotation[]} annotations
 */
export function renderWhatFailed(annotations) {
	const items = failureItems(annotations);
	const total = reportedFailureCount(annotations);
	const collapse = connectionCollapse(annotations);

	if (items.length === 0 && total === null) return '';

	/** @type {string[]} */
	const out = ['**What failed**', ''];

	if (collapse) {
		const where = collapse.origin ? ` to ${collapse.origin}` : '';
		out.push(
			`Every annotated failure is a refused or dropped connection${where} — nothing was ` +
				`listening. That is the web server dying or never binding, not a regression in the ` +
				`specs below, and the list is whichever tests ran into the hole first.`,
			''
		);
	}

	if (items.length === 0) {
		out.push(`The run reported **${total}** failures and annotated none of them.`, '');
	} else if (total !== null && total > items.length) {
		out.push(
			`Showing **${items.length} of ${total}** failures. GitHub annotates only the first few ` +
				`numbered ones, so this list is where the run started failing, not the extent of it — ` +
				`open the job log for the rest.`,
			''
		);
	}

	out.push(...items);
	return `${out.join('\n')}\n`;
}

async function main() {
	/** @type {Buffer[]} */
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	const raw = Buffer.concat(chunks).toString('utf8').trim();
	if (raw === '') return;

	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) return;

	process.stdout.write(renderWhatFailed(parsed));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
