<script lang="ts">
	import { resolve } from '$app/paths';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RosterTable from '$lib/components/events/RosterTable.svelte';
	import { getEventRsvpRoster } from '$lib/remote/event-rsvp.remote';

	let { eventId }: { eventId: string } = $props();

	// Null when the viewer can read the listing but not its contact data.
	const roster = $derived(await getEventRsvpRoster(eventId));
</script>

{#if roster}
	<InfoCard title="RSVPs" state={roster.total}>
		{#snippet action()}
			{#if roster.total > 0}
				<Button
					href={resolve(`/staff/events/${eventId}/rsvps.csv`)}
					rel="external"
					download
					variant="ghost"
					size="sm">Export CSV</Button
				>
			{/if}
		{/snippet}
		{#if roster.total === 0}
			<EmptyState title="No RSVPs yet" description="Members RSVP from the event's public page." />
		{:else}
			<RosterTable rows={roster.rows} atLabel="RSVP'd" />
		{/if}
	</InfoCard>
{/if}
