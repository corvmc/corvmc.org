import { db } from '$lib/server/db';
import { inboxChannelConfig } from '$lib/server/db/schema/inbox';
import { eq } from 'drizzle-orm';
import { inboxChannels, isAlwaysEnabledChannel } from '$lib/config';
import type { InboxChannel } from '$lib/server/db/schema/inbox';

export interface ChannelConfigRow {
	channel: InboxChannel;
	enabled: boolean;
	config: Record<string, unknown>;
}

/**
 * The one channel that is deliberately absent from the settings page and the
 * staff queue's channel filter.
 *
 * `band` is always enabled — `isChannelEnabled` and `getChannelConfig` both
 * short-circuit on it, which is what lets the dispatcher send a band's reply —
 * but there is nothing for staff to configure and nothing for them to filter to:
 * `staffVisibleThread` excludes every band thread, so the option would only ever
 * produce an empty list. Listing it would advertise a queue that is not theirs.
 */
const STAFF_CONFIGURABLE = inboxChannels.filter((ch) => ch !== 'band');

export async function getAllChannelConfigs(): Promise<ChannelConfigRow[]> {
	const rows = await db.select().from(inboxChannelConfig);
	const byChannel = new Map(rows.map((r) => [r.channel, r]));

	return STAFF_CONFIGURABLE.map((ch) => {
		const row = byChannel.get(ch);
		return {
			channel: ch,
			enabled: isAlwaysEnabledChannel(ch) ? true : (row?.enabled ?? false),
			config: (row?.config as Record<string, unknown>) ?? {}
		};
	});
}

export async function getChannelConfig(channel: InboxChannel): Promise<ChannelConfigRow> {
	if (isAlwaysEnabledChannel(channel)) {
		return { channel, enabled: true, config: {} };
	}

	const [row] = await db
		.select()
		.from(inboxChannelConfig)
		.where(eq(inboxChannelConfig.channel, channel))
		.limit(1);

	return {
		channel,
		enabled: row?.enabled ?? false,
		config: (row?.config as Record<string, unknown>) ?? {}
	};
}

export async function isChannelEnabled(channel: InboxChannel): Promise<boolean> {
	if (isAlwaysEnabledChannel(channel)) return true;

	const [row] = await db
		.select({ enabled: inboxChannelConfig.enabled })
		.from(inboxChannelConfig)
		.where(eq(inboxChannelConfig.channel, channel))
		.limit(1);

	return row?.enabled ?? false;
}

export async function getEnabledChannels(): Promise<InboxChannel[]> {
	const configs = await getAllChannelConfigs();
	return configs.filter((c) => c.enabled).map((c) => c.channel);
}

export async function updateChannelConfig(channel: InboxChannel, enabled: boolean): Promise<void> {
	// An always-on channel has no toggle in the UI. Writing a row anyway would
	// store a disabled flag that every read ignores, which reads as a bug later.
	if (isAlwaysEnabledChannel(channel)) return;

	const [existing] = await db
		.select()
		.from(inboxChannelConfig)
		.where(eq(inboxChannelConfig.channel, channel))
		.limit(1);

	if (existing) {
		await db
			.update(inboxChannelConfig)
			.set({ enabled, updatedAt: new Date() })
			.where(eq(inboxChannelConfig.channel, channel));
	} else {
		await db.insert(inboxChannelConfig).values({ channel, enabled });
	}
}
