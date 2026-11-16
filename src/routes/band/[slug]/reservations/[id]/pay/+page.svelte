<script lang="ts">
	import ReservationPayment from '#lib/components/reservations/ReservationPayment.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	// The band is resolved from the reservation's row, not this route's slug.
	const params = routeParams('id');
</script>

<ReservationPayment id={params.id} panel="band" />
