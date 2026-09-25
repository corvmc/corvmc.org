import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ballot, ballotElector } from '$lib/server/db/schema/ballot';
import { user } from '$lib/server/db/schema/authentication';
import {
	getNotificationType,
	notification,
	notificationPreference
} from '$lib/server/db/schema/notification';
import { normalizeNotificationModel } from '$lib/server/notification/email/normalize-model';
import { sendTemplateBatch } from '$lib/server/notification/email';
import { pushToUser } from '$lib/server/notification/sse';
import { captureException } from '$lib/server/sentry';
import type { BallotEvent } from '$lib/server/event-bus/event-bus';

/**
 * The two ballot notices. Opening reaches the electors; certification reaches
 * every active account. Both are roster-sized, so they batch the way
 * `announcement-fanout.ts` does rather than calling `dispatch()` in a loop.
 */

type NoticeType = 'ballot_opened' | 'ballot_result';

/** Seven bound columns per notification row, under D1's 100-parameter cap. */
const INSERT_CHUNK = 12;

export function ballotHref(ballotId: string): string {
	return `/member/ballots/${ballotId}`;
}

async function claim(ballotId: string, type: NoticeType): Promise<boolean> {
	const column = type === 'ballot_opened' ? ballot.openNoticeSentAt : ballot.resultPublishedAt;
	const key = type === 'ballot_opened' ? 'openNoticeSentAt' : 'resultPublishedAt';
	const claimed = await db
		.update(ballot)
		.set({ [key]: new Date() })
		.where(and(eq(ballot.id, ballotId), isNull(column)))
		.returning({ id: ballot.id });
	return claimed.length > 0;
}

async function recipients(ballotId: string, type: NoticeType) {
	const defaults = getNotificationType(type)?.defaults ?? { email: false, inApp: true, sms: false };
	const base = db
		.select({
			userId: user.id,
			name: user.name,
			email: user.email,
			emailEnabled: notificationPreference.emailEnabled,
			inAppEnabled: notificationPreference.inAppEnabled
		})
		.from(user)
		.leftJoin(
			notificationPreference,
			and(
				eq(notificationPreference.userId, user.id),
				eq(notificationPreference.notificationType, type)
			)
		)
		.$dynamic();
	const active = and(isNull(user.deletedAt), isNull(user.bannedAt));
	const rows =
		type === 'ballot_opened'
			? await base
					.innerJoin(
						ballotElector,
						and(eq(ballotElector.userId, user.id), eq(ballotElector.ballotId, ballotId))
					)
					.where(active)
			: await base.where(active);
	return rows.map((r) => ({
		...r,
		emailEnabled: r.emailEnabled ?? defaults.email,
		inAppEnabled: r.inAppEnabled ?? defaults.inApp
	}));
}

function copy(type: NoticeType, title: string) {
	return type === 'ballot_opened'
		? { title: `Ballot open: ${title}`, body: 'You are on the roll. Your vote is waiting.' }
		: { title: `Ballot result: ${title}`, body: 'The result has been certified.' };
}

export async function fanOutBallotNotice(
	type: NoticeType,
	event: BallotEvent,
	siteUrl: string
): Promise<void> {
	if (!(await claim(event.ballotId, type))) return;

	const people = await recipients(event.ballotId, type);
	const href = ballotHref(event.ballotId);
	const { title, body } = copy(type, event.title);

	const inApp = people.filter((p) => p.inAppEnabled);
	if (inApp.length > 0) {
		try {
			const statements = [];
			for (let i = 0; i < inApp.length; i += INSERT_CHUNK) {
				statements.push(
					db.insert(notification).values(
						inApp.slice(i, i + INSERT_CHUNK).map((p) => ({
							userId: p.userId,
							type,
							title,
							body,
							href,
							data: { ballotId: event.ballotId }
						}))
					)
				);
			}
			await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
			const createdAt = new Date().toISOString();
			for (const p of inApp) {
				pushToUser(p.userId, { id: event.ballotId, type, title, body, href, createdAt });
			}
		} catch (err) {
			captureException(err, { event: `${type}.fanout`, channel: 'in-app' });
		}
	}

	const byEmail = people.filter((p) => p.emailEnabled);
	if (byEmail.length > 0) {
		try {
			await sendTemplateBatch(
				'notification',
				byEmail.map((p) => ({
					to: p.email,
					model: normalizeNotificationModel({
						subject: title,
						heading: title,
						greeting: `Hi ${p.name.split(' ')[0]},`,
						paragraphs: [{ text: body }],
						cta: { url: `${siteUrl}${href}`, label: 'Open the ballot' }
					})
				})),
				{ tag: type }
			);
		} catch (err) {
			captureException(err, { event: `${type}.fanout`, channel: 'email' });
		}
	}
}
