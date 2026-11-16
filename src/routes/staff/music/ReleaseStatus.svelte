<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/components/ui/Badge.svelte';

	let { status }: { status: string } = $props();
</script>

{#if status === 'published'}
	<Badge size="sm" variant="success">{m.staff_published_label()}</Badge>
{:else if status === 'withheld'}
	<Badge size="sm" variant="error">{m.staff_music_withheld_label()}</Badge>
{:else}
	<Badge size="sm" variant="ghost">{m.staff_draft_label()}</Badge>
{/if}
