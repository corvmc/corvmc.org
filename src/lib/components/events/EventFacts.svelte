<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconCalendar, IconClock, IconMapPin, IconTicket } from '@tabler/icons-svelte';
	import { fullDate, formatTime } from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { priceDisplay } from '#lib/utils/event-ticketing.js';
	import { mapUrl } from '#lib/utils/place.js';

	let {
		evt
	}: {
		evt: Parameters<typeof priceDisplay>[0] & {
			startsAt: Date;
			endsAt: Date | null;
			doorsAt: Date | null;
			location: string | null;
			address?: string | null;
		};
	} = $props();

	const price = $derived(priceDisplay(evt));
</script>

<!-- One fact per row: the values are never of equal width. The icon stands in
     for the label, which stays in the `dt` for screen readers. -->
<dl class="edet__facts">
	<div class="edet__fact">
		<dt class="edet__fact-label">
			<IconCalendar size={18} aria-hidden="true" />
			<span class="sr-only">{m.events_facts_date()}</span>
		</dt>
		<dd class="edet__fact-value">{fullDate(evt.startsAt)}</dd>
	</div>
	<div class="edet__fact">
		<dt class="edet__fact-label">
			<IconClock size={18} aria-hidden="true" />
			<span class="sr-only">{m.events_facts_time()}</span>
		</dt>
		<dd class="edet__fact-value">
			{formatEventTimeRange(evt.startsAt, evt.endsAt)}
			{#if evt.doorsAt}
				<span class="edet__fact-note block"
					>{m.events_facts_doors({ formatTime: formatTime(evt.doorsAt) })}</span
				>
			{/if}
		</dd>
	</div>
	{#if evt.location || evt.address}
		<div class="edet__fact">
			<dt class="edet__fact-label">
				<IconMapPin size={18} aria-hidden="true" />
				<span class="sr-only">{m.events_facts_location()}</span>
			</dt>
			<dd class="edet__fact-value">
				{evt.location ?? ''}
				{#if evt.address}
					{#if evt.location}<br />{/if}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- an external map, not an internal route -->
					<a href={mapUrl(evt)} target="_blank" rel="noopener noreferrer external" class="link"
						>{evt.address}</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</dd>
		</div>
	{/if}
	<div class="edet__fact">
		<dt class="edet__fact-label">
			<IconTicket size={18} aria-hidden="true" />
			<span class="sr-only">{m.events_facts_price()}</span>
		</dt>
		<dd class="edet__fact-value">
			{price.label}
			{#if price.suggested}
				<span class="edet__fact-note">{m.events_facts_suggested()}</span>
			{/if}
		</dd>
	</div>
</dl>
