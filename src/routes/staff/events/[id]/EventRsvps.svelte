<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RosterTable from '$lib/components/roster/RosterTable.svelte';
	import CopyEmailsButton from '$lib/components/roster/CopyEmailsButton.svelte';
	import { getEventRsvpRoster } from '$lib/remote/event-rsvp.remote';
	import { formatDateTimeShort } from '$lib/utils/format';

	let { eventId }: { eventId: string } = $props();

	// Null when the viewer can read the listing but not its contact data.
	const roster = $derived(await getEventRsvpRoster(eventId));
</script>

{#if roster}
	<InfoCard title={m.staff_events_id_event_rsvps_rsvps()} state={roster.total}>
		{#snippet action()}
			{#if roster.total > 0}
				<div class="flex gap-1">
					<CopyEmailsButton emails={roster.rows.map((r) => r.email)} />
					<Button
						href={resolve(`/staff/events/${eventId}/rsvps.csv`)}
						rel="external"
						download
						variant="ghost"
						size="sm">{m.staff_events_id_event_rsvps_export_csv()}</Button
					>
				</div>
			{/if}
		{/snippet}
		{#if roster.total === 0}
			<EmptyState
				title={m.staff_events_id_event_rsvps_no_rsvps_yet()}
				description={m.staff_events_id_event_rsvps_description()}
			/>
		{:else}
			<RosterTable rows={roster.rows}>
				{#snippet columns()}
					<th class="col-extra">{m.staff_events_id_event_rsvps_rsvp_d()}</th>
				{/snippet}
				{#snippet cells(row)}
					<td class="col-extra whitespace-nowrap">{formatDateTimeShort(row.rsvpedAt)}</td>
				{/snippet}
			</RosterTable>
		{/if}
	</InfoCard>
{/if}
