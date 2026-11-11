<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The venue's partner calendar feeds (#1459). The daily cron copies each
	 * unpaused feed's upcoming shows onto the gig guide; "Fetch now" runs one
	 * immediately, paused or not.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { formatDateTimeShort } from '#lib/utils/format.js';
	import {
		getVenueFeeds,
		addVenueFeed,
		setVenueFeedPaused,
		removeVenueFeed,
		fetchVenueFeed
	} from '#lib/remote/venues.remote.js';

	let { venueId }: { venueId: string } = $props();

	const feeds = $derived(await getVenueFeeds(venueId));
	const addForm = $derived(addVenueFeed.for(venueId));
</script>

<InfoCard title={m.staff_venues_id_venue_feeds_title()} state={feeds.length}>
	{#snippet action()}
		<Action
			action={addForm}
			label={m.staff_add_label()}
			variant="ghost"
			size="sm"
			modalTitle={m.staff_venues_id_venue_feeds_add_calendar_feed_title()}
			submitLabel={m.staff_add_label()}
			successToast={m.staff_added_toast()}
		>
			{#snippet form()}
				<input {...addForm.fields.venueId.as('hidden', venueId)} />
				<Field
					field={addForm.fields.url}
					type="text"
					label={m.staff_venues_id_venue_feeds_icalendar_url_label()}
				/>
			{/snippet}
		</Action>
	{/snippet}

	{#if feeds.length > 0}
		<Table packed={false}>
			{#snippet head()}
				<th>{m.staff_venues_id_venue_feeds_feed_label()}</th>
				<th class="col-support">{m.staff_venues_id_venue_feeds_last_fetched_label()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
			{/snippet}
			{#each feeds as feed (feed.id)}
				<tr data-testid="venue-feed">
					<td class="max-w-0">
						<div class="truncate" title={feed.url}>{feed.url}</div>
						<div class="flex flex-wrap gap-1">
							{#if feed.paused}<Badge size="sm"
									>{m.staff_venues_id_venue_feeds_paused_label()}</Badge
								>{/if}
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
								label={m.staff_venues_id_venue_feeds_fetch_now_label()}
								variant="ghost"
								size="xs"
								successToast={m.staff_venues_id_venue_feeds_fetched_toast()}
								noFooter
							>
								{#snippet form()}
									<input {...fetchVenueFeed.for(feed.id).fields.id.as('hidden', feed.id)} />
								{/snippet}
							</Action>
							<Action
								action={setVenueFeedPaused.for(feed.id)}
								label={feed.paused
									? m.staff_venues_id_venue_feeds_resume_label()
									: m.staff_venues_id_venue_feeds_pause_label()}
								variant="ghost"
								size="xs"
								successToast={feed.paused
									? m.staff_venues_id_venue_feeds_resumed_toast()
									: m.staff_venues_id_venue_feeds_paused_toast()}
								noFooter
							>
								{#snippet form()}
									<input {...setVenueFeedPaused.for(feed.id).fields.id.as('hidden', feed.id)} />
									<input
										{...setVenueFeedPaused
											.for(feed.id)
											.fields.paused.as('hidden', feed.paused ? 'false' : 'true')}
									/>
								{/snippet}
							</Action>
							<Action
								action={removeVenueFeed.for(feed.id)}
								label={m.staff_remove_label()}
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle={m.staff_venues_id_venue_feeds_remove_feed_title()}
								submitLabel={m.staff_remove_label()}
								submitVariant="error"
								successToast={m.staff_removed_toast()}
							>
								{#snippet form()}
									<input {...removeVenueFeed.for(feed.id).fields.id.as('hidden', feed.id)} />
									<p class="text-sm">
										{m.staff_venues_id_venue_feeds_shows_already_added_stay_guide_text()}
									</p>
								{/snippet}
							</Action>
						</div>
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</InfoCard>
