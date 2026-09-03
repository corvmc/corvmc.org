<script lang="ts">
	import PressKitProgress from '$lib/components/band/PressKitProgress.svelte';
	import { getPressKitProgress } from '$lib/remote/press-kit.remote';

	/**
	 * The dashboard's progress card, owning its own query.
	 *
	 * It lives in a component rather than on the page because the dashboard
	 * already has one load-bearing query (its upcoming sessions), and a second
	 * awaited beside it is the fan-out `custom/no-concurrent-remote-queries`
	 * exists to stop. Nothing here blocks first paint: the sessions render, and
	 * this fills in.
	 */
	let { slug }: { slug: string } = $props();

	const progress = await getPressKitProgress(slug);
</script>

<PressKitProgress
	{slug}
	sections={progress.sections}
	done={progress.done}
	total={progress.total}
	next={progress.next}
	compact
/>
