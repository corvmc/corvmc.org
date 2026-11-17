<script lang="ts">
	import ReservationPayment from '#lib/components/reservations/ReservationPayment.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');
</script>

<ReservationPayment id={params.id} panel="member" />
