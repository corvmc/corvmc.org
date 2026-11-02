import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { stockMovement } from '$lib/server/db/schema/inventory';
import { jobsForAsset } from '$lib/server/contractor/contractor-job-service';
import { listLoans } from './loan-service';
import { stockReasonLabels, type ContractorJobStatus, type StockReason } from '$lib/config';
import { feedLimit, mergeFeed, type FeedItem, type FeedPage } from '$lib/types/activity';

/**
 * The history cards on an item's and a unit's pages, as feed rows. Each read
 * takes `limit + 1`, so a card can page past what used to be a silent cap
 * (100 movements, 50 loans).
 */

export interface MovementFeedItem extends FeedItem {
	kind: 'movement';
	quantity: number;
	reason: StockReason;
}

export interface ServiceFeedItem extends FeedItem {
	kind: 'service';
	job: { id: string; workOrderId: string; projectId: string | null; status: ContractorJobStatus };
	costCents: number | null;
	contractor: { id: string; name: string };
}

export type AssetHistoryItem = MovementFeedItem | ServiceFeedItem;

export interface LoanFeedItem extends FeedItem {
	loanId: string;
	status: string;
	isOverdue: boolean;
	dueDate: Date | null;
	chargeCents: number | null;
}

export async function listMovementFeed(
	scope: { itemId: string } | { assetId: string },
	opts: { limit?: number } = {}
): Promise<FeedPage<MovementFeedItem>> {
	const limit = feedLimit(opts.limit);
	const rows = await db
		.select({
			id: stockMovement.id,
			quantity: stockMovement.quantity,
			reason: stockMovement.reason,
			notes: stockMovement.notes,
			at: stockMovement.occurredAt,
			actorId: stockMovement.actorId,
			actorName: user.name
		})
		.from(stockMovement)
		.leftJoin(user, eq(user.id, stockMovement.actorId))
		.where(
			'itemId' in scope
				? eq(stockMovement.itemId, scope.itemId)
				: eq(stockMovement.assetId, scope.assetId)
		)
		.orderBy(desc(stockMovement.occurredAt), desc(stockMovement.createdAt), desc(stockMovement.id))
		.limit(limit + 1);
	const items = rows.slice(0, limit).map((r) => ({
		kind: 'movement' as const,
		id: `move:${r.id}`,
		at: r.at,
		actorId: r.actorId,
		actorName: r.actorName,
		summary: r.notes ? `${stockReasonLabels[r.reason]}: ${r.notes}` : stockReasonLabels[r.reason],
		quantity: r.quantity,
		reason: r.reason
	}));
	return { items, hasMore: rows.length > limit };
}

/** A unit's ledger and the paid work done on it, as one feed. Service is `contractor.read`'s. */
export async function listAssetHistory(
	assetId: string,
	opts: { limit?: number; withService: boolean }
): Promise<FeedPage<AssetHistoryItem>> {
	const limit = feedLimit(opts.limit);
	const [movements, jobs] = await Promise.all([
		listMovementFeed({ assetId }, { limit }),
		opts.withService ? jobsForAsset(assetId) : Promise.resolve([])
	]);
	const service: ServiceFeedItem[] = jobs.map(({ job, contractor }) => ({
		kind: 'service',
		id: `job:${job.id}`,
		at: job.completedAt ?? job.scheduledFor ?? job.createdAt,
		actorId: null,
		actorName: null,
		summary: job.title,
		job: {
			id: job.id,
			workOrderId: job.workOrderId,
			projectId: job.projectId,
			status: job.status as ContractorJobStatus
		},
		costCents: job.costCents,
		contractor: { id: contractor.id, name: contractor.name }
	}));
	return mergeFeed<AssetHistoryItem>(limit, movements, { items: service, hasMore: false });
}

/** An item's loans, newest request first. The borrower is the summary, not the actor. */
export async function listLoanFeed(
	itemId: string,
	opts: { limit?: number } = {}
): Promise<FeedPage<LoanFeedItem>> {
	const limit = feedLimit(opts.limit);
	const { rows, pagination } = await listLoans({ itemId }, { page: 1, pageSize: limit });
	return {
		items: rows.map((loan) => ({
			id: `loan:${loan.id}`,
			at: loan.createdAt,
			actorId: null,
			actorName: null,
			summary: loan.member.title,
			loanId: loan.id,
			status: loan.status,
			isOverdue: loan.isOverdue,
			dueDate: loan.dueDate,
			chargeCents: loan.totalChargeCents
		})),
		hasMore: pagination.total > limit
	};
}
