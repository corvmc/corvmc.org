<script lang="ts">
	import { page } from '$app/state';
	import BallotDetail from '$lib/components/ballot/BallotDetail.svelte';
	import { getBallotPage } from '$lib/remote/ballots.remote';

	const data = $derived(await getBallotPage(page.params.id!));
</script>

<BallotDetail {data} panel="staff" />
