import { listAuditEntriesForSubject, type AuditSubjectFilter } from './audit-service';
import { auditFeedItem } from '$lib/utils/audit-display';
import type { FeedPage } from '$lib/types/activity';

/**
 * The audit read as feed rows: what a record's History card renders. Kept out
 * of `audit-service`, which every listener imports, so the display code and its
 * config imports stay off that module graph.
 */
export async function listAuditFeed(
	subjects: AuditSubjectFilter | AuditSubjectFilter[],
	opts: { limit?: number } = {}
): Promise<FeedPage> {
	const { entries, hasMore } = await listAuditEntriesForSubject(subjects, opts);
	return { items: entries.map(auditFeedItem), hasMore };
}
