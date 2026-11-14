<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/components/ui/Badge.svelte';

	let {
		release
	}: { release: { radioExcluded: boolean; radioOptIn: boolean; radioAttested: boolean } } =
		$props();
</script>

{#if release.radioExcluded}
	<Badge size="sm" variant="warning">{m.staff_music_pulled_label()}</Badge>
{:else if release.radioOptIn && release.radioAttested}
	<Badge size="sm" variant="info">{m.staff_music_opted_label()}</Badge>
{:else if release.radioOptIn}
	<Badge size="sm" variant="warning">{m.staff_music_not_attested_label()}</Badge>
{:else}
	<span class="text-subtle">—</span>
{/if}
