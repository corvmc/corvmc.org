<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import type { ReservationRef } from '$lib/types/entity';

	/**
	 * The room held for a listing, which is the listing's (#1948). Rendered
	 * whether or not anything is held: omitting it made "no space held" read the
	 * same as "this page doesn't show holds". An outside venue answers the
	 * question instead of asking for a room the show will never hold.
	 */
	interface Props {
		venueName: string | null;
		venueIsPrimary: boolean;
		reservation: { ref: ReservationRef } | null;
	}

	let { venueName, venueIsPrimary, reservation }: Props = $props();
</script>

<InfoCard title="Space Reservation">
	{#if venueName && !venueIsPrimary}
		<p class="text-muted">
			Off-site — {venueName}. The practice space stays bookable while this runs.
		</p>
	{:else if reservation}
		<EntityIdentity ref={reservation.ref} size="md" status />
	{:else}
		<p class="text-muted">No space held for this event. Use Edit to reserve the practice space.</p>
	{/if}
</InfoCard>
