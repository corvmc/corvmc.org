<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { invalidateAll } from '$app/navigation';
	import { CancelTicketAction } from '$lib/components/shared/actions';
	import { checkInTicket, getStaffCheckIn } from '$lib/remote/events.remote';
	import { page } from '$app/state';
	import StatCard from '$lib/components/shared/StatCard.svelte';
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

<PageHeader title="Check-in: {data.event.title}" backHref="/staff/events/{data.event.id}" />
<PageContent width="3xl">
	<!-- Stats -->
	<div class="flex gap-6">
		<StatCard title="Checked In" value={data.stats.checkedIn} size="sm" class="p-4" />
		<StatCard title="Tickets Sold" value={data.stats.sold} size="sm" class="p-4" />
	</div>

	<!-- Search -->
	<input
		type="text"
		bind:value={search}
		placeholder="Search by name, email, or code..."
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
						<p class="font-mono text-xs opacity-50 mt-1">{ticket.code}</p>
					</div>

					<div class="flex items-center gap-3">
						{#if ticket.status === 'checked_in'}
							<StatusBadge status="checked_in" />
						{:else if ticket.status === 'cancelled'}
							<StatusBadge status="cancelled" />
						{:else}
							<Form
								remote={checkInTicket.for(ticket.id)}
								successToast="Checked in"
								onsuccess={() => invalidateAll()}
								class="inline"
							>
								<input {...fields.ticketId.as('hidden', ticket.id)} />
								<SubmitButton label="Check In" variant="primary" size="sm" />
							</Form>
							<CancelTicketAction
								eventId={data.event.id}
								ticketId={ticket.id}
								attendeeName={ticket.attendeeName}
							/>
						{/if}
					</div>
				</CardBody>
			</Card>
		{/each}

		{#if filteredTickets.length === 0}
			<p class="text-center opacity-50 py-8">
				{search ? 'No tickets match your search' : 'No tickets to check in'}
			</p>
		{/if}
	</div>
</PageContent>
