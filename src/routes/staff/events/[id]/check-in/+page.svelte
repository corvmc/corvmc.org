<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { refreshAll } from '$app/navigation';
	import { CancelTicketAction } from '#lib/components/actions/index.js';
	import { checkInTicket, getStaffCheckIn } from '#lib/remote/events.remote.js';
	import { page } from '$app/state';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import DoorScanner from './DoorScanner.svelte';
	const { fields } = checkInTicket;

	let data = $derived(await getStaffCheckIn(page.params.id!));

	let search = $state('');

	const filteredTickets = $derived(
		data.tickets.filter((t) => {
			if (!search) return true;
			const q = search.toLowerCase();
			return (
				t.attendeeName.toLowerCase().includes(q) ||
				t.attendeeEmail.toLowerCase().includes(q) ||
				t.code.toLowerCase().includes(q)
			);
		})
	);
</script>

<PageHeader
	width="3xl"
	title={m.staff_events_id_check_in_check({ title: data.event.title })}
	crumb="Check-in"
	parent={{ label: data.event.title, href: resolve('/staff/events/[id]', { id: data.event.id }) }}
/>
<PageContent width="3xl">
	<!-- Stats -->
	<div class="flex gap-6">
		<StatCard
			title={m.staff_events_id_check_in_checked()}
			value={data.stats.checkedIn}
			size="sm"
			class="p-4"
		/>
		<StatCard
			title={m.staff_events_id_check_in_tickets_sold()}
			value={data.stats.sold}
			size="sm"
			class="p-4"
		/>
	</div>

	<!-- The scanner leads, and the list below is the fallback it degrades to.
	     Searching per person is workable for fifty and not for two hundred. -->
	<DoorScanner tickets={data.tickets} eventId={data.event.id} />

	<!-- Search -->
	<input
		type="text"
		bind:value={search}
		placeholder={m.staff_events_id_check_in_placeholder()}
		class="input w-full"
	/>

	<!-- Ticket list -->
	<div class="space-y-2">
		{#each filteredTickets as ticket (ticket.id)}
			<Card>
				<CardBody row padding="sm">
					<div>
						<p class="font-medium">{ticket.attendeeName}</p>
						<p class="text-muted">{ticket.attendeeEmail}</p>
						<p class="mt-1 font-mono text-subtle">{ticket.code}</p>
					</div>

					<div class="flex items-center gap-3">
						{#if ticket.status === 'checked_in'}
							<StatusBadge status="checked_in" />
						{:else if ticket.status === 'cancelled'}
							<StatusBadge status="cancelled" />
						{:else}
							<!-- 44px on purpose: tapped a hundred times in a row at a
							     door, one-handed. daisyUI's default `btn` is 40 (#971). -->
							<Form
								remote={checkInTicket.for(ticket.id)}
								successToast={m.staff_events_id_check_in_success_toast()}
								onsuccess={() => refreshAll()}
								class="inline"
							>
								<input {...fields.ticketId.as('hidden', ticket.id)} />
								<input {...fields.eventId.as('hidden', page.params.id!)} />
								<SubmitButton
									label={m.staff_events_id_check_in_label()}
									variant="primary"
									class="min-h-11"
								/>
							</Form>
							<CancelTicketAction ticketId={ticket.id} attendeeName={ticket.attendeeName} />
						{/if}
					</div>
				</CardBody>
			</Card>
		{/each}

		{#if filteredTickets.length === 0}
			<p class="py-8 text-center opacity-50">
				{search
					? m.staff_events_id_check_in_no_tickets_match_search()
					: m.staff_events_id_check_in_no_tickets_check()}
			</p>
		{/if}
	</div>
</PageContent>
