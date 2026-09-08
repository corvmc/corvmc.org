<script lang="ts">
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

<PageHeader title="Venues" subtitle="Events">
	<Action action={createVenue} label="New venue" modalTitle="New venue" successToast="Venue added">
		{#snippet form()}
			<Field field={fields.name} type="text" label="Name" />
			<Field field={fields.address1} type="text" label="Address" />
			<Field field={fields.city} type="text" label="City" />
			<Field field={fields.state} type="text" label="State" />
			<Field field={fields.postalCode} type="text" label="ZIP" />
			<Field field={fields.capacity} type="number" label="Capacity" min="1" />
			<Field field={fields.contactName} type="text" label="Contact" />
			<Field field={fields.contactEmail} type="email" label="Contact email" />
			<Field field={fields.contactPhone} type="tel" label="Contact phone" />
			<Field
				field={fields.loadInNotes}
				type="text"
				label="Load-in"
				description="Where the van goes, which door is unlocked, who has the key."
			/>
			<Field field={fields.notes} type="textarea" label="Notes" />
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
			<span class="font-medium">No practice room</span>
			Nothing is marked as ours yet, so no event can be told apart from an off-site one. Open the room's
			row and choose <em>Make this the room</em>.
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
			Show archived
		</label>
	</div>

	{#if venues.length === 0}
		<EmptyState
			title="No venues yet"
			description="Add the practice room first and mark it as ours, then the outside rooms we produce in."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Name</th>
				<th>Where</th>
				<th class="cell-num">Capacity</th>
				<th class="cell-num">Events</th>
			{/snippet}
			{#each venues as v (v.id)}
				<tr class="hover" class:opacity-60={v.deletedAt}>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/venues/${v.id}`)}>{v.name}</a>
						{#if v.isPrimary}
							<Badge variant="primary" size="sm" class="ml-2">Our room</Badge>
						{/if}
						{#if v.deletedAt}
							<Badge variant="ghost" size="sm" class="ml-2">Archived</Badge>
						{/if}
					</td>
					<td>{addressLine(v) || '—'}</td>
					<td class="cell-num">{v.capacity ?? '—'}</td>
					<td class="cell-num">{v.eventCount}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
