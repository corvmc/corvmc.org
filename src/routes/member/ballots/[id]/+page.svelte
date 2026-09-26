<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import BallotDetail from '$lib/components/ballot/BallotDetail.svelte';
	import { getBallotPage } from '$lib/remote/ballots.remote';

	const data = $derived(await getBallotPage(page.params.id!));
</script>

<BallotDetail {data} backHref={resolve('/member/ballots')} panel="member" />
