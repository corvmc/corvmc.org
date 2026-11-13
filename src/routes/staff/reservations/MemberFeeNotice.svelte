<script lang="ts">
	import { getMemberFeeGate } from '#lib/remote/reservations.remote.js';
	import FeeNotice from '#lib/components/reservations/booking/FeeNotice.svelte';

	/**
	 * The member's outstanding fees as a warning (#2748); staff are never refused.
	 * Its own component so the create modal keeps one remote query in flight.
	 */
	let { memberId }: { memberId: string } = $props();
</script>

<FeeNotice gate={await getMemberFeeGate(memberId)} />
