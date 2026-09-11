<script lang="ts">
	/**
	 * The door list, for the person on the door.
	 *
	 * Narrower than `/staff/events/[id]/check-in` on purpose: a name and a code
	 * are what it takes to find somebody at the door, an email address is not,
	 * and cancelling a ticket stays with staff. The show is decided by the
	 * signup, so this page cannot be pointed at another night.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { checkInAsVolunteer, getMyShiftCheckIn } from '$lib/remote/volunteer.remote';

	const signupId = $derived(page.params.signupId!);
	const data = $derived(await getMyShiftCheckIn(signupId));

	let search = $state('');

	const matching = $derived(
		data.tickets.filter((t) => {
			if (!search.trim()) return true;
			const q = search.trim().toLowerCase();
			return t.attendeeName.toLowerCase().includes(q) || t.code.toLowerCase().includes(q);
		})
	);
</script>

<PageHeader
	title="Check-in"
	subtitle={data.event.title}
	backHref={resolve(`/member/volunteer/shifts/${signupId}`)}
/>
<PageContent width="2xl">
	<div class="flex gap-4">
		<StatCard title="Checked in" value={data.stats.checkedIn} size="sm" class="p-4" />
		<StatCard title="Tickets sold" value={data.stats.sold} size="sm" class="p-4" />
	</div>

	<SearchInput bind:value={search} placeholder="Search by name or code" />

	<div class="space-y-2">
		{#each matching as ticket (ticket.id)}
			<Card>
				<CardBody row padding="sm">
					<div class="min-w-0">
						<p class="truncate font-medium">{ticket.attendeeName}</p>
						<p class="font-mono text-subtle text-sm">{ticket.code}</p>
					</div>
					{#if ticket.status === 'checked_in'}
						<StatusBadge status="checked_in" />
					{:else}
						<Form
							remote={checkInAsVolunteer.for(ticket.id)}
							successToast="Checked in"
							class="inline"
						>
							<input type="hidden" name="ticketId" value={ticket.id} />
							<input type="hidden" name="signupId" value={signupId} />
							<SubmitButton label="Check in" variant="primary" size="sm" />
						</Form>
					{/if}
				</CardBody>
			</Card>
		{:else}
			<p class="py-8 text-center text-muted">
				{search ? 'Nobody matches that.' : 'No tickets to check in.'}
			</p>
		{/each}
	</div>
</PageContent>
