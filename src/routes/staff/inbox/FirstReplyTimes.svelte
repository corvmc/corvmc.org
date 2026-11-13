<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Median time to a first reply, per staff channel. Reads the view tabs'
	 * cached counts entry, which carries these figures. Unanswered threads are
	 * outside the median, so their count sits beside it.
	 */
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import { channelIcon, channelLabel } from '#lib/components/inbox/channels.js';
	import { getInboxThreadCounts } from '#lib/remote/inbox.remote.js';
	import { FIRST_RESPONSE_WINDOW_DAYS } from '#lib/config.js';
	import { formatElapsed } from '#lib/utils/format.js';

	const { firstResponse } = $derived(await getInboxThreadCounts());
</script>

{#if firstResponse.length > 0}
	<section class="flex w-full max-w-md flex-col gap-2" data-testid="first-reply-times">
		<SectionLabel label={m.staff_inbox_first_reply_times_label()} />
		<p class="text-muted text-sm">
			{m.staff_inbox_first_reply_window_text({ days: FIRST_RESPONSE_WINDOW_DAYS })}
		</p>
		<ul class="divide-y divide-base-300">
			{#each firstResponse as row (row.channel)}
				{@const Icon = channelIcon(row.channel)}
				<li class="flex items-start gap-3 py-2">
					<Icon size={18} class="mt-0.5 shrink-0" />
					<div class="min-w-0 flex-1">
						<div class="font-medium">{channelLabel(row.channel)}</div>
						<div class="text-muted text-sm">
							{m.staff_inbox_first_reply_answered_text({ count: row.replied })}{#if row.waiting > 0}
								· {m.staff_inbox_first_reply_waiting_text({ count: row.waiting })}{/if}
						</div>
					</div>
					<div class="shrink-0 font-semibold tabular-nums">
						{row.medianSeconds === null
							? m.staff_inbox_first_reply_no_replies_text()
							: formatElapsed(row.medianSeconds)}
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
