<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { getBandDoorList, checkInBandTicket } from '$lib/remote/band-ticket-sale.remote';

	let { slug, eventId }: { slug: string; eventId: string } = $props();

	// Declared before the awaited query: see the note on `updateFields` in +page.svelte.
	const fields = checkInBandTicket.fields;

	const door = $derived(await getBandDoorList({ slug, eventId }));
	const refresh = () => getBandDoorList({ slug, eventId }).refresh();
</script>

<!-- The band's own door (#1543), on the same idempotent check-in staff use. -->
{#if door.tickets.length > 0}
	<Card>
		<CardBody>
			<CardTitle>{m.band_slug_events_event_id_door_list_card_door_list()}</CardTitle>
			<p class="text-muted">
				{m.band_slug_events_event_id_door_list_card_checked({
					checkedIn: door.checkedIn,
					length: door.tickets.length
				})}
			</p>
			<ul class="divide-y divide-base-300">
				{#each door.tickets as ticket (ticket.id)}
					<li class="flex items-center justify-between gap-3 py-2">
						<div>
							<p class="font-medium">{ticket.attendeeName}</p>
							<p class="font-mono text-subtle">{ticket.code}</p>
						</div>
						{#if ticket.status === 'checked_in'}
							<StatusBadge status="checked_in" />
						{:else}
							<Form
								remote={checkInBandTicket.for(ticket.id)}
								successToast={m.band_slug_events_event_id_door_list_card_success_toast()}
								onsuccess={refresh}
								class="inline"
							>
								<input {...fields.slug.as('hidden', slug)} />
								<input {...fields.eventId.as('hidden', eventId)} />
								<input {...fields.ticketId.as('hidden', ticket.id)} />
								<SubmitButton
									label={m.band_slug_events_event_id_door_list_card_label()}
									variant="primary"
									class="min-h-11"
								/>
							</Form>
						{/if}
					</li>
				{/each}
			</ul>
		</CardBody>
	</Card>
{/if}
