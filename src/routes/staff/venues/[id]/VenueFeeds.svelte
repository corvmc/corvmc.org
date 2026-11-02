<script lang="ts">
	/**
	 * The venue's partner calendar feeds (#1459). The daily cron copies each
	 * unpaused feed's upcoming shows onto the gig guide; "Fetch now" runs one
	 * immediately, paused or not.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { formatDateTimeShort } from '$lib/utils/format';
	import {
		getVenueFeeds,
		addVenueFeed,
		setVenueFeedPaused,
		removeVenueFeed,
		fetchVenueFeed
	} from '$lib/remote/venues.remote';

	let { venueId }: { venueId: string } = $props();

	const feeds = $derived(await getVenueFeeds(venueId));
	const addForm = $derived(addVenueFeed.for(venueId));
</script>

<InfoCard title="Calendar feeds" state={feeds.length}>
	{#snippet action()}
		<Action
			action={addForm}
			label="Add"
			variant="ghost"
			size="sm"
			modalTitle="Add a calendar feed"
			submitLabel="Add"
			successToast="Added"
		>
			{#snippet form()}
				<input type="hidden" name="venueId" value={venueId} />
				<Field field={addForm.fields.url} type="text" label="iCalendar URL" />
			{/snippet}
		</Action>
	{/snippet}

	{#if feeds.length > 0}
		<Table packed={false}>
			{#snippet head()}
				<th>Feed</th>
				<th class="col-support">Last fetched</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
			{/snippet}
			{#each feeds as feed (feed.id)}
				<tr data-testid="venue-feed">
					<td class="max-w-0">
						<div class="truncate" title={feed.url}>{feed.url}</div>
						<div class="flex flex-wrap gap-1">
							{#if feed.paused}<Badge size="sm">Paused</Badge>{/if}
							{#if feed.lastError}
								<span class="text-sm text-error">{feed.lastError}</span>
							{/if}
						</div>
					</td>
					<td class="col-support whitespace-nowrap">
						{#if feed.lastFetchedAt}
							{formatDateTimeShort(feed.lastFetchedAt)}
							{#if feed.lastImportedCount != null}· {feed.lastImportedCount}{/if}
						{:else}
							—
						{/if}
					</td>
					<td>
						<div class="flex w-max justify-end gap-1">
							<Action
								action={fetchVenueFeed.for(feed.id)}
								label="Fetch now"
								variant="ghost"
								size="xs"
								successToast="Fetched"
								noFooter
							>
								{#snippet form()}
									<input type="hidden" name="id" value={feed.id} />
								{/snippet}
							</Action>
							<Action
								action={setVenueFeedPaused.for(feed.id)}
								label={feed.paused ? 'Resume' : 'Pause'}
								variant="ghost"
								size="xs"
								successToast={feed.paused ? 'Resumed' : 'Paused'}
								noFooter
							>
								{#snippet form()}
									<input type="hidden" name="id" value={feed.id} />
									<input type="hidden" name="paused" value={feed.paused ? 'false' : 'true'} />
								{/snippet}
							</Action>
							<Action
								action={removeVenueFeed.for(feed.id)}
								label="Remove"
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle="Remove this feed?"
								submitLabel="Remove"
								submitVariant="error"
								successToast="Removed"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={feed.id} />
									<p class="text-sm">Shows it already added stay on the guide.</p>
								{/snippet}
							</Action>
						</div>
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</InfoCard>
