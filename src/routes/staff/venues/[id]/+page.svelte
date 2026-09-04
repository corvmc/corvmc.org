<script lang="ts">
	/**
	 * One venue.
	 *
	 * The primary flag leads, because it is the only field on this page anything
	 * branches on. Everything below it is what a producer looks up on the day:
	 * the address, who to ring, and where the van goes.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		getVenueDetail,
		updateVenue,
		setPrimaryVenue,
		archiveVenue,
		restoreVenue,
		deleteVenue
	} from '$lib/remote/venues.remote';

	const id = $derived(page.params.id!);
	const venue = $derived(await getVenueDetail(id));

	const editForm = $derived(updateVenue.for(id));
	const { fields } = $derived(editForm);

	const address = $derived(
		[venue.address1, [venue.city, venue.state].filter(Boolean).join(', '), venue.postalCode]
			.filter(Boolean)
			.join(' · ')
	);
	const contact = $derived(
		[venue.contactName, venue.contactEmail, venue.contactPhone].filter(Boolean).join(' · ')
	);
</script>

<PageHeader title={venue.name} subtitle="Venue" backHref="/staff/venues">
	<Action
		action={editForm}
		label="Edit"
		variant="ghost"
		size="sm"
		modalTitle="Edit {venue.name}"
		submitLabel="Save"
		successToast="Saved"
	>
		{#snippet form()}
			<input type="hidden" name="id" value={venue.id} />
			<Field field={fields.name} type="text" label="Name" value={venue.name} />
			<Field field={fields.address1} type="text" label="Address" value={venue.address1 ?? ''} />
			<Field field={fields.city} type="text" label="City" value={venue.city ?? ''} />
			<Field field={fields.state} type="text" label="State" value={venue.state ?? ''} />
			<Field field={fields.postalCode} type="text" label="ZIP" value={venue.postalCode ?? ''} />
			<Field
				field={fields.capacity}
				type="number"
				label="Capacity"
				min="1"
				value={venue.capacity != null ? String(venue.capacity) : ''}
			/>
			<Field
				field={fields.contactName}
				type="text"
				label="Contact"
				value={venue.contactName ?? ''}
			/>
			<Field
				field={fields.contactEmail}
				type="email"
				label="Contact email"
				value={venue.contactEmail ?? ''}
			/>
			<Field
				field={fields.contactPhone}
				type="tel"
				label="Contact phone"
				value={venue.contactPhone ?? ''}
			/>
			<Field
				field={fields.loadInNotes}
				type="text"
				label="Load-in"
				value={venue.loadInNotes ?? ''}
				description="Where the van goes, which door is unlocked, who has the key."
			/>
			<Field field={fields.notes} type="textarea" label="Notes" value={venue.notes ?? ''} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	{#if venue.deletedAt}
		<Alert type="warning">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<span>
					<span class="font-medium">Archived.</span> It stays on every event that named it, and is off
					the picker for new ones.
				</span>
				<Action
					action={restoreVenue.for(venue.id)}
					label="Restore"
					variant="ghost"
					size="xs"
					successToast="Restored"
					noFooter
				>
					{#snippet form()}
						<input type="hidden" name="id" value={venue.id} />
					{/snippet}
				</Action>
			</div>
		</Alert>
	{/if}

	<InfoCard title="Where">
		{#if venue.isPrimary}
			<p>
				<Badge variant="primary" size="sm">Our room</Badge>
				<span class="ml-2 text-muted">A show here holds the practice space.</span>
			</p>
		{:else}
			<p class="text-muted">
				A show here holds nothing — the practice space stays bookable while it runs.
			</p>
		{/if}

		<dl class="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
			<div>
				<dt class="text-subtle text-sm">Address</dt>
				<dd>{address || '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-sm">Capacity</dt>
				<dd>{venue.capacity ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-sm">Contact</dt>
				<dd>{contact || '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-sm">Load-in</dt>
				<dd>{venue.loadInNotes ?? '—'}</dd>
			</div>
		</dl>

		{#if venue.notes}
			<p class="mt-3 text-sm">{venue.notes}</p>
		{/if}
	</InfoCard>

	<div class="flex flex-wrap gap-2">
		{#if !venue.isPrimary && !venue.deletedAt}
			<Action
				action={setPrimaryVenue.for(venue.id)}
				label="Make this the room"
				variant="ghost"
				size="sm"
				modalTitle="Make {venue.name} the practice room?"
				submitLabel="Make it the room"
				successToast="Done"
			>
				{#snippet form()}
					<input type="hidden" name="id" value={venue.id} />
					<p class="text-sm">
						Exactly one venue is ours, so whichever holds it now gives it up. From then on a show
						here holds the practice space and a show anywhere else does not.
					</p>
				{/snippet}
			</Action>
		{/if}

		{#if !venue.isPrimary && !venue.deletedAt}
			<Action
				action={archiveVenue.for(venue.id)}
				label="Archive"
				variant="ghost"
				size="sm"
				modalTitle="Archive {venue.name}?"
				submitLabel="Archive"
				successToast="Archived"
			>
				{#snippet form()}
					<input type="hidden" name="id" value={venue.id} />
					<p class="text-sm">
						It comes off the picker for new events and stays on every event that already names it.
					</p>
				{/snippet}
			</Action>
		{/if}

		{#if !venue.isPrimary}
			<Action
				action={deleteVenue.for(venue.id)}
				label="Delete"
				variant="ghost"
				size="sm"
				class="text-error"
				modalTitle="Delete {venue.name}?"
				submitLabel="Delete"
				submitVariant="error"
				successToast="Deleted"
				onsuccess={() => goto(resolve('/staff/venues'))}
			>
				{#snippet form()}
					<input type="hidden" name="id" value={venue.id} />
					<p class="text-sm">
						For a row that should never have existed. Refused once any event names it — archive
						those instead.
					</p>
				{/snippet}
			</Action>
		{/if}
	</div>
</PageContent>
