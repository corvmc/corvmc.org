<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import type { ReservationRef } from '#lib/types/entity.js';
	import EditHoldAction from './EditHoldAction.svelte';

	/**
	 * The room held for a listing, which is the listing's (#1948). Rendered
	 * whether or not anything is held: omitting it made "no space held" read the
	 * same as "this page doesn't show holds". An outside venue answers the
	 * question instead of asking for a room the show will never hold.
	 */
	interface Props {
		venueName: string | null;
		venueIsPrimary: boolean;
		reservation: { ref: ReservationRef; startsAt: Date; endsAt: Date } | null;
		/** Set when the viewer may move the hold. */
		editableEventId?: string;
	}

	let { venueName, venueIsPrimary, reservation, editableEventId }: Props = $props();
</script>

<InfoCard title={m.events_space_hold_card_title()} testid="space-hold">
	{#snippet action()}
		{#if reservation && editableEventId}
			<EditHoldAction
				eventId={editableEventId}
				startsAt={reservation.startsAt}
				endsAt={reservation.endsAt}
			/>
		{/if}
	{/snippet}
	{#if venueName && !venueIsPrimary}
		<p class="text-muted">
			{m.events_space_hold_card_off_site_practice_space_stays({ venueName })}
		</p>
	{:else if reservation}
		<EntityIdentity ref={reservation.ref} size="md" status />
	{:else}
		<p class="text-muted">{m.events_space_hold_card_no_space_held_event_use()}</p>
	{/if}
</InfoCard>
