<script lang="ts">
	import { IconCheck, IconShare3 } from '@tabler/icons-svelte';

	/**
	 * Copies the current page URL and flashes a checkmark.
	 *
	 * Three pages had a byte-identical `share()` plus the same icon-swapping
	 * button. The clipboard call can reject — permissions, or a non-secure
	 * context — and the copies all swallowed that silently, which is the right
	 * behaviour for a convenience affordance: failing loudly on a copy the user
	 * may not have initiated is worse than the checkmark simply not appearing.
	 */
	let {
		title = 'Copy link to this page',
		class: extraClass = 'btn btn-ghost btn-sm btn-square'
	}: {
		/** Tooltip text — name the thing being shared ("Copy link to this event"). */
		title?: string;
		class?: string;
	} = $props();

	let copied = $state(false);

	async function share() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable — no-op
		}
	}
</script>

<button type="button" class={extraClass} {title} onclick={share}>
	{#if copied}
		<IconCheck size={18} />
	{:else}
		<IconShare3 size={18} />
	{/if}
</button>
