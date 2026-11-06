<script lang="ts">
	import BallotDetail from '#lib/components/ballot/BallotDetail.svelte';
	import { getBallotPage } from '#lib/remote/ballots.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const data = $derived(await getBallotPage(params.id));
</script>

<BallotDetail {data} panel="member" />
