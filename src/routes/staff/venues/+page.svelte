<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * Where shows happen.
	 *
	 * The room leads the list and says so, because the whole reason this table
	 * exists is the one question free text could never answer: does an event here
	 * hold the practice space? Everything else on the row — address, capacity,
	 * how many shows we have put on there — is reference.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { getVenues, createVenue } from '$lib/remote/venues.remote';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const includeArchived = $derived(page.url.searchParams.get('archived') === '1');
	const venues = $derived(await getVenues({ includeArchived }));
	const { fields } = createVenue;

	const hasPrimary = $derived(venues.some((v) => v.isPrimary && !v.deletedAt));

	function setArchived(on: boolean) {
		const url = new URL(page.url);
		if (on) url.searchParams.set('archived', '1');
		else url.searchParams.delete('archived');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function addressLine(v: { city: string | null; state: string | null }): string {
		return [v.city, v.state].filter(Boolean).join(', ');
	}
</script>

<PageHeader title={m.staff_venues_venues()} subtitle={m.staff_events()}>
	<Action
		action={createVenue}
		label={m.staff_venues_new_venue()}
		modalTitle={m.staff_venues_new_venue()}
		successToast={m.staff_venues_success_toast()}
	>
		{#snippet form()}
			<Field field={fields.name} type="text" label={m.staff_name()} />
			<Field field={fields.address1} type="text" label={m.staff_address()} />
			<Field field={fields.city} type="text" label={m.staff_city()} />
			<Field field={fields.state} type="text" label={m.staff_state()} />
			<Field field={fields.postalCode} type="text" label={m.staff_zip()} />
			<Field field={fields.capacity} type="number" label={m.staff_capacity()} min="1" />
			<Field field={fields.contactName} type="text" label={m.staff_contact()} />
			<Field field={fields.contactEmail} type="email" label={m.staff_contact_email()} />
			<Field field={fields.contactPhone} type="tel" label={m.staff_contact_phone()} />
			<Field
				field={fields.loadInNotes}
				type="text"
				label={m.staff_load()}
				description={m.staff_where_van_goes_which_door()}
			/>
			<Field field={fields.notes} type="textarea" label={m.staff_notes()} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if !hasPrimary}
		<!--
			Not cosmetic. `holdsSpace` reads "no venue" as "assume the room", so with
			no primary row every event booked at a venue behaves as if it were
			off-site — including the ones that are not.
		-->
		<Alert type="warning">
			<span class="font-medium">{m.staff_venues_no_practice_room()}</span>
			Nothing is marked as ours yet, so no event can be told apart from an off-site one. Open the room's
			row and choose <em>{m.staff_make_room()}</em>.
		</Alert>
	{/if}

	<div class="flex justify-end">
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={includeArchived}
				onchange={(e) => setArchived(e.currentTarget.checked)}
			/>
			{m.staff_show_archived()}
		</label>
	</div>

	{#if venues.length === 0}
		<EmptyState
			title={m.staff_venues_no_venues_yet()}
			description={m.staff_venues_add_practice_room_first_mark()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_name()}</th>
				<th>{m.staff_where()}</th>
				<th class="cell-num">{m.staff_capacity()}</th>
				<th class="cell-num">{m.staff_events()}</th>
			{/snippet}
			{#each venues as v (v.id)}
				<tr class="hover" class:opacity-60={v.deletedAt}>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/venues/${v.id}`)}>{v.name}</a>
						{#if v.isPrimary}
							<Badge variant="primary" size="sm" class="ml-2">{m.staff_our_room()}</Badge>
						{/if}
						{#if v.deletedAt}
							<Badge variant="ghost" size="sm" class="ml-2">{m.staff_archived()}</Badge>
						{/if}
					</td>
					<td>{addressLine(v) || '—'}</td>
					<td class="cell-num">{v.capacity ?? '—'}</td>
					<td class="cell-num">{v.eventCount}</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={venues.length} unit="venues" />
	{/if}
</PageContent>
