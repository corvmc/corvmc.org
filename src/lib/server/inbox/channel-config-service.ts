import { db } from '$lib/server/db';
import { inboxChannelConfig } from '$lib/server/db/schema/inbox';
import { eq } from 'drizzle-orm';
import { staffInboxChannels, isAlwaysEnabledChannel, type StaffInboxChannel } from '$lib/config';
import type { InboxChannel } from '$lib/server/db/schema/inbox';

export interface ChannelConfigRow {
	channel: StaffInboxChannel;
	enabled: boolean;
	config: Record<string, unknown>;
}

export async function getAllChannelConfigs(): Promise<ChannelConfigRow[]> {
	const rows = await db.select().from(inboxChannelConfig);
	const byChannel = new Map(rows.map((r) => [r.channel, r]));

	// `staffInboxChannels`, not `inboxChannels`: `direct` is member↔member and has
	// nothing staff can configure. Synthesising a row for it put a channel the
	// settings page has no metadata for into this list.
	return staffInboxChannels.map((ch) => {
		const row = byChannel.get(ch);
		return {
			channel: ch,
			enabled: isAlwaysEnabledChannel(ch) ? true : (row?.enabled ?? false),
			config: (row?.config as Record<string, unknown>) ?? {}
		};
	});
}

export async function getChannelConfig(channel: StaffInboxChannel): Promise<ChannelConfigRow> {
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

export async function getEnabledChannels(): Promise<StaffInboxChannel[]> {
	const configs = await getAllChannelConfigs();
	return configs.filter((c) => c.enabled).map((c) => c.channel);
}

export async function updateChannelConfig(
	channel: StaffInboxChannel,
	enabled: boolean
): Promise<void> {
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
