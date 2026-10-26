/**
 * Where a PR stands between "auto-merge armed" and "merged", read from GitHub.
 *
 * The armed flag alone misleads both ways: GitHub consumes it when the PR enters the queue, and a
 * PR whose own required checks went red stays armed and `BLOCKED` forever without the queue ever
 * seeing it — the guard workflow fires on `dequeued`, so that PR is never labelled. `classify` is
 * the one place that tells those apart; `pr-await.mjs` and `queue-sweep.mjs` both read it.
 */
import { execFileSync } from 'node:child_process';

export const REPO = { owner: 'corvmc', name: 'corvmc.org' };

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR', 'STARTUP_FAILURE']);

/**
 * @typedef {{ name: string, conclusion: string | null, url: string | null }} Check
 * @typedef {{ type: string, at: string, reason?: string | null }} QueueEvent
 * @typedef {{
 *   number: number, title: string, url: string, state: 'OPEN' | 'CLOSED' | 'MERGED',
 *   isDraft: boolean, author: string, headSha: string, labels: string[],
 *   armed: boolean, mergeStateStatus: string, queueEntry: { state: string, position: number } | null,
 *   checks: Check[], events: QueueEvent[]
 * }} PrSnapshot
 * @typedef {'merged' | 'closed' | 'queued' | 'rejected' | 'stuck' | 'pending' | 'unarmed' | 'draft'} PrStatus
 * @typedef {{ status: PrStatus, detail: string, failing: Check[] }} PrState
 */

/**
 * @param {PrSnapshot} pr
 * @param {string[]} required  required status check names on `main`
 * @returns {PrState}
 */
export function classify(pr, required) {
	const none = /** @type {Check[]} */ ([]);
	if (pr.state === 'MERGED') return { status: 'merged', detail: 'merged', failing: none };
	if (pr.state === 'CLOSED') return { status: 'closed', detail: 'closed unmerged', failing: none };
	if (pr.queueEntry) {
		const { state, position } = pr.queueEntry;
		return { status: 'queued', detail: `in queue, position ${position} (${state})`, failing: none };
	}

	// Rejected: the guard's label, or a removal from the queue nothing has re-armed since.
	const last = [...pr.events].reverse().find((e) => e.type !== 'HeadRefForcePushedEvent');
	if (pr.labels.includes('queue-rejected'))
		return { status: 'rejected', detail: 'labelled queue-rejected', failing: none };
	if (!pr.armed && last?.type === 'RemovedFromMergeQueueEvent')
		return {
			status: 'rejected',
			detail: `removed from queue${last.reason ? `: ${last.reason}` : ''}`,
			failing: none
		};

	if (pr.isDraft) return { status: 'draft', detail: 'draft', failing: none };
	if (!pr.armed)
		return { status: 'unarmed', detail: 'ready but auto-merge not armed', failing: none };

	const failing = pr.checks.filter(
		(c) => required.includes(c.name) && c.conclusion !== null && FAILED.has(c.conclusion)
	);
	if (pr.mergeStateStatus === 'DIRTY')
		return { status: 'stuck', detail: 'armed but conflicts with main', failing };
	if (failing.length > 0)
		return {
			status: 'stuck',
			detail: `armed but required checks failed: ${failing.map((c) => c.name).join(', ')}`,
			failing
		};
	return { status: 'pending', detail: 'armed, waiting on its own checks', failing: none };
}

/** @param {string[]} args */
function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** @returns {string[]} */
export function requiredChecks() {
	const rules = JSON.parse(gh(['api', `repos/${REPO.owner}/${REPO.name}/rules/branches/main`]));
	return rules
		.filter((/** @type {{ type: string }} */ r) => r.type === 'required_status_checks')
		.flatMap((/** @type {any} */ r) =>
			r.parameters.required_status_checks.map((/** @type {{ context: string }} */ c) => c.context)
		);
}

const QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) {
      number title url state isDraft mergeStateStatus
      author { login }
      headRefOid
      labels(first: 20) { nodes { name } }
      autoMergeRequest { enabledAt }
      mergeQueueEntry { state position }
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
        __typename
        ... on CheckRun { name conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      } } } } } }
      timelineItems(last: 15, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT, AUTO_MERGE_ENABLED_EVENT, AUTO_MERGE_DISABLED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT]) {
        nodes {
          __typename
          ... on AddedToMergeQueueEvent { createdAt }
          ... on RemovedFromMergeQueueEvent { createdAt reason }
          ... on AutoMergeEnabledEvent { createdAt }
          ... on AutoMergeDisabledEvent { createdAt }
          ... on HeadRefForcePushedEvent { createdAt }
        }
      }
    }
  }
}`;

/**
 * @param {number} n
 * @returns {PrSnapshot}
 */
export function fetchPr(n) {
	const out = gh([
		'api',
		'graphql',
		'-f',
		`query=${QUERY}`,
		'-F',
		`owner=${REPO.owner}`,
		'-F',
		`name=${REPO.name}`,
		'-F',
		`n=${n}`
	]);
	const pr = JSON.parse(out).data.repository.pullRequest;
	const contexts = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
	return {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		state: pr.state,
		isDraft: pr.isDraft,
		author: pr.author?.login ?? '',
		headSha: pr.headRefOid,
		labels: pr.labels.nodes.map((/** @type {{ name: string }} */ l) => l.name),
		armed: pr.autoMergeRequest !== null,
		mergeStateStatus: pr.mergeStateStatus,
		queueEntry: pr.mergeQueueEntry,
		checks: contexts.map((/** @type {any} */ c) =>
			c.__typename === 'CheckRun'
				? { name: c.name, conclusion: c.conclusion, url: c.detailsUrl }
				: {
						name: c.context,
						conclusion: c.state === 'PENDING' || c.state === 'EXPECTED' ? null : c.state,
						url: c.targetUrl
					}
		),
		events: pr.timelineItems.nodes.map((/** @type {any} */ e) => ({
			type: e.__typename,
			at: e.createdAt,
			reason: e.reason ?? null
		}))
	};
}

/** @returns {{ number: number, isBot: boolean, isDraft: boolean }[]} */
export function openPrs() {
	const list = gh([
		'pr',
		'list',
		'--repo',
		`${REPO.owner}/${REPO.name}`,
		'--state',
		'open',
		'--limit',
		'100',
		'--json',
		'number,author,isDraft'
	]);
	return JSON.parse(list).map(
		(/** @type {{ number: number, author: { is_bot: boolean }, isDraft: boolean }} */ p) => ({
			number: p.number,
			isBot: p.author.is_bot,
			isDraft: p.isDraft
		})
	);
}

/** Open `ci-failure` issues: `main` itself is red, so a queue rejection may not be the PR's. */
export function mainRedIssues() {
	return JSON.parse(
		gh([
			'issue',
			'list',
			'--repo',
			`${REPO.owner}/${REPO.name}`,
			'--label',
			'ci-failure',
			'--state',
			'open',
			'--json',
			'number,title'
		])
	);
}
