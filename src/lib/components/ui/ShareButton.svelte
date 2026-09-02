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
		url = null,
		label = null,
		class: extraClass = 'btn btn-ghost btn-sm btn-square'
	}: {
		/** Tooltip text — name the thing being shared ("Copy link to this event"). */
		title?: string;
		/**
		 * The address to copy. Defaults to the current page, which is right for a
		 * page that *is* the thing being shared and wrong for one that merely
		 * displays it: a band profile lives at `{slug}.corvmc.org`, and copying
		 * `/directory/bands/{slug}` handed out the plumbing instead of the address.
		 *
		 * Pass `null` (or nothing) to keep the current-URL behaviour — which is
		 * also the fallback when a canonical address cannot be built, because a
		 * link that works beats a prettier one that does not.
		 */
		url?: string | null;
		/**
		 * Text beside the icon. Omitted by default: in a page header the icon
		 * alone is the affordance, and `title` names it. A card whose whole
		 * subject is the address wants the word.
		 */
		label?: string | null;
		class?: string;
	} = $props();

	let copied = $state(false);

	async function share() {
		try {
			await navigator.clipboard.writeText(url ?? window.location.href);
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
	{#if label}
		<span>{copied ? 'Copied' : label}</span>
	{/if}
</button>
