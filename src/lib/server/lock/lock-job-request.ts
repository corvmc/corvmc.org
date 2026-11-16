import { deleteKey, getJson, putJson } from '#lib/server/kv.js';
import { runDailyLockJob, type LockJobSummary } from './lock-service';

/**
 * A staff request to run the daily lock job ahead of its 16:00 UTC batch.
 *
 * The job makes dozens of U-tec calls and runs past 40 seconds, longer than a
 * request's `waitUntil` survives (30 s after the response). So the button only
 * records the request and `/api/cron/lock-job-requested` runs it on the next
 * 5-minute tick, under the cron's 15-minute wall clock.
 */
export interface LockJobRequest {
	/** ISO time of the press. A later press replaces it. */
	at: string;
	requestedBy: string | null;
}

const REQUEST_KEY = 'ultraloc:jobRequested';

export async function requestLockJobRun(requestedBy: string | null): Promise<LockJobRequest> {
	const request = { at: new Date().toISOString(), requestedBy };
	await putJson<LockJobRequest>(REQUEST_KEY, request);
	return request;
}

export async function getLockJobRequest(): Promise<LockJobRequest | null> {
	return getJson<LockJobRequest>(REQUEST_KEY);
}

/**
 * Run the job if staff asked for it, then clear the request. A press that
 * lands while the job runs leaves a newer request behind, so it runs next tick.
 */
export async function runRequestedLockJob(): Promise<LockJobSummary | null> {
	const request = await getLockJobRequest();
	if (!request) return null;

	const summary = await runDailyLockJob(request.requestedBy);

	const current = await getLockJobRequest();
	if (current?.at === request.at) await deleteKey(REQUEST_KEY);
	return summary;
}
