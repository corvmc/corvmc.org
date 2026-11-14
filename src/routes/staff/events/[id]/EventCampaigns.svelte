<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { Latest } from '#lib/latest.svelte.js';
	import { withQuery } from '#lib/utils/with-query.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { getEventCampaigns } from '#lib/remote/marketing.remote.js';

	/**
	 * The campaigns about this show, and a way to start one with the show and
	 * its ticket holders already chosen (#2776). Off for a staffer who may not
	 * read campaigns.
	 */
	let { eventId }: { eventId: string } = $props();

	// Read in Latest's effect, so the page does not wait on it.
	const data = new Latest(() => getEventCampaigns(eventId));
	$effect(() => {
		if (data.error) throw data.error.e;
	});

	const newHref = $derived(
		withQuery(resolve('/staff/marketing/campaigns/new'), new URLSearchParams({ event: eventId }))
	);
</script>

{#if data.current}
	{@const { campaigns, canCreate } = data.current}
	<InfoCard title={m.staff_events_id_campaigns_title()} testid="event-campaigns">
		{#snippet header(title)}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				{#if canCreate}
					<Button href={newHref} variant="ghost" size="sm" data-testid="email-ticket-holders">
						{m.staff_events_id_email_ticket_holders_label()}
					</Button>
				{/if}
			</div>
		{/snippet}
		{#if campaigns.length === 0}
			<p class="text-subtle">{m.staff_events_id_no_campaigns_text()}</p>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_campaign_label()}</th>
				{/snippet}
				{#each campaigns as c (c.id)}
					{@const href =
						c.status === 'draft'
							? resolve(`staff/marketing/campaigns/${c.id}/edit`)
							: resolve(`staff/marketing/campaigns/${c.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px"><StatusBadge status={c.status} /></td>
						<td class="cell-primary"><EntityIdentity ref={c.ref} /></td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
{/if}
