<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import type { InstructorListingView } from './listing';

	/** The listing's rows, for a `DefinitionList` the caller owns. */
	let { listing }: { listing: InstructorListingView } = $props();

	const reach = $derived(
		{
			public: m.staff_members_instructors_reach_public_text(),
			members: m.staff_members_instructors_reach_members_text(),
			hidden: m.staff_members_instructors_reach_hidden_text(),
			missing: m.staff_members_instructors_reach_missing_text()
		}[listing.directoryReach]
	);
</script>

<Fact label={m.staff_teaches_label()} value={listing.headline ?? '—'} />
<Fact label={m.staff_members_instructors_listing_about_label()} wrap>
	<span class="whitespace-pre-line">{listing.blurb ?? '—'}</span>
</Fact>
<Fact label={m.staff_members_instructors_listing_rates_label()} value={listing.ratesNote ?? '—'} />
<Fact label={m.staff_members_instructors_listing_booking_label()} wrap>
	{#if listing.bookingUrl}
		<a
			class="link break-all"
			href={listing.bookingUrl}
			rel="noopener noreferrer nofollow external"
			target="_blank">{listing.bookingUrl}</a
		>
	{:else}
		—
	{/if}
</Fact>
<Fact label={m.staff_members_instructors_listing_directory_label()} value={reach} />
