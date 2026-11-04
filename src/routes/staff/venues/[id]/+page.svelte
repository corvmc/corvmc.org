<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/**
	 * One venue.
	 *
	 * The primary flag leads, because it is the only field on this page anything
	 * branches on. Everything below it is what a producer looks up on the day:
	 * the address, who to ring, and where the van goes.
	 */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import VenueFeeds from './VenueFeeds.svelte';
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
	} from '#lib/remote/venues.remote.js';

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

<PageHeader width="3xl" title={venue.name} subtitle={m.staff_venue()}>
	<Action
		action={editForm}
		label={m.staff_edit()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2({ name: venue.name })}
		submitLabel={m.staff_save()}
		successToast={m.staff_saved()}
	>
		{#snippet form()}
			<input {...editForm.fields.id.as('hidden', venue.id)} />
			<Field field={fields.name} type="text" label={m.staff_name()} value={venue.name} />
			<Field
				field={fields.address1}
				type="text"
				label={m.staff_address()}
				value={venue.address1 ?? ''}
			/>
			<Field field={fields.city} type="text" label={m.staff_city()} value={venue.city ?? ''} />
			<Field field={fields.state} type="text" label={m.staff_state()} value={venue.state ?? ''} />
			<Field
				field={fields.postalCode}
				type="text"
				label={m.staff_zip()}
				value={venue.postalCode ?? ''}
			/>
			<Field
				field={fields.capacity}
				type="number"
				label={m.staff_capacity()}
				min="1"
				value={venue.capacity != null ? String(venue.capacity) : ''}
			/>
			<Field
				field={fields.contactName}
				type="text"
				label={m.staff_contact()}
				value={venue.contactName ?? ''}
			/>
			<Field
				field={fields.contactEmail}
				type="email"
				label={m.staff_contact_email()}
				value={venue.contactEmail ?? ''}
			/>
			<Field
				field={fields.contactPhone}
				type="tel"
				label={m.staff_contact_phone()}
				value={venue.contactPhone ?? ''}
			/>
			<Field
				field={fields.loadInNotes}
				type="text"
				label={m.staff_load()}
				value={venue.loadInNotes ?? ''}
				description={m.staff_where_van_goes_which_door()}
			/>
			<Field
				field={fields.notes}
				type="textarea"
				label={m.staff_notes()}
				value={venue.notes ?? ''}
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	{#if venue.deletedAt}
		<Alert type="warning">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<span>
					<ParaglideMessage
						message={m.staff_venues_id_stays_every_event_named_off}
						inputs={{ staff_archived_2: m.staff_archived_2() }}
						>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				</span>
				<Action
					action={restoreVenue.for(venue.id)}
					label={m.staff_restore()}
					variant="ghost"
					size="xs"
					successToast={m.staff_restored()}
					noFooter
				>
					{#snippet form()}
						<input {...restoreVenue.for(venue.id).fields.id.as('hidden', venue.id)} />
					{/snippet}
				</Action>
			</div>
		</Alert>
	{/if}

	<InfoCard title={m.staff_where()}>
		{#if venue.isPrimary}
			<p>
				<Badge variant="primary" size="sm">{m.staff_our_room()}</Badge>
				<span class="ml-2 text-muted">{m.staff_venues_id_show_here_holds_practice_space()}</span>
			</p>
		{:else}
			<p class="text-muted">
				{m.staff_venues_id_show_here_holds_nothing_practice()}
			</p>
		{/if}

		<dl class="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
			<div>
				<dt class="text-subtle text-sm">{m.staff_address()}</dt>
				<dd>{address || '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-sm">{m.staff_capacity()}</dt>
				<dd>{venue.capacity ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-sm">{m.staff_contact()}</dt>
				<dd>{contact || '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-sm">{m.staff_load()}</dt>
				<dd>{venue.loadInNotes ?? '—'}</dd>
			</div>
		</dl>

		{#if venue.notes}
			<p class="mt-3 text-sm">{venue.notes}</p>
		{/if}
	</InfoCard>

	{#if !venue.isPrimary}
		<VenueFeeds venueId={venue.id} />
	{/if}

	<div class="flex flex-wrap gap-2">
		{#if !venue.isPrimary && !venue.deletedAt}
			<Action
				action={setPrimaryVenue.for(venue.id)}
				label={m.staff_make_room()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_venues_id_make_practice_room({ name: venue.name })}
				submitLabel={m.staff_venues_id_make_room()}
				successToast={m.staff_done()}
			>
				{#snippet form()}
					<input {...setPrimaryVenue.for(venue.id).fields.id.as('hidden', venue.id)} />
					<p class="text-sm">
						{m.staff_venues_id_exactly_one_venue_ours_so()}
					</p>
				{/snippet}
			</Action>
		{/if}

		{#if !venue.isPrimary && !venue.deletedAt}
			<Action
				action={archiveVenue.for(venue.id)}
				label={m.staff_archive()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_archive_2({ name: venue.name })}
				submitLabel={m.staff_archive()}
				successToast={m.staff_archived()}
			>
				{#snippet form()}
					<input {...archiveVenue.for(venue.id).fields.id.as('hidden', venue.id)} />
					<p class="text-sm">
						{m.staff_venues_id_comes_off_picker_new_events()}
					</p>
				{/snippet}
			</Action>
		{/if}

		{#if !venue.isPrimary}
			<Action
				action={deleteVenue.for(venue.id)}
				label={m.staff_delete()}
				variant="ghost"
				size="sm"
				class="text-error"
				modalTitle={m.staff_delete_2({ name: venue.name })}
				submitLabel={m.staff_delete()}
				submitVariant="error"
				successToast={m.staff_deleted()}
				onsuccess={() => goto(resolve('/staff/venues'))}
			>
				{#snippet form()}
					<input {...deleteVenue.for(venue.id).fields.id.as('hidden', venue.id)} />
					<p class="text-sm">
						{m.staff_venues_id_row_should_never_have_existed()}
					</p>
				{/snippet}
			</Action>
		{/if}
	</div>
</PageContent>
