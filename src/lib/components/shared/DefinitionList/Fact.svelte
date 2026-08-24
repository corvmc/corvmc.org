<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * One label/value row inside a `DefinitionList`.
	 *
	 * Renders `<dt>` and `<dd>` as siblings with no wrapper — see the note in
	 * `DefinitionList.svelte` for why that matters.
	 *
	 * Pass the value as children when it needs markup (a link, a badge, a
	 * conditional), or as `value` when it is plain text.
	 */
	let {
		label,
		value,
		mono = false,
		wrap = false,
		class: extraClass = '',
		children
	}: {
		label: string;
		/** Plain-text value. Ignored when `children` is supplied. */
		value?: string | number | null;
		/** Monospace + smaller, for IDs and provider record keys. */
		mono?: boolean;
		/** Preserve newlines, for free-text notes. */
		wrap?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();

	const ddClass = $derived(
		[mono ? 'font-mono text-xs' : '', wrap ? 'whitespace-pre-wrap' : '', extraClass]
			.filter(Boolean)
			.join(' ')
	);
</script>

<dt class="opacity-60">{label}</dt>
<dd class={ddClass}>
	{#if children}
		{@render children()}
	{:else}
		{value}
	{/if}
</dd>
