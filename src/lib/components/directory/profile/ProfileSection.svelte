<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		note,
		actions,
		children
	}: {
		title: string;
		note?: string;
		/** right-aligned header content (e.g. a segmented toggle); overrides `note` */
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="profile-section card bg-base-100 shadow">
	<header class="profile-section__head">
		<h2 class="profile-section__title">{title}</h2>
		{#if actions}
			{@render actions()}
		{:else if note}
			<span class="profile-section__note">{note}</span>
		{/if}
	</header>
	<div class="profile-section__body">
		{@render children()}
	</div>
</section>

<style>
	.profile-section {
		border: 1px solid var(--surface-border);
	}
	.profile-section__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: 1px solid color-mix(in oklch, var(--cmc-brown) 14%, transparent);
	}
	.profile-section__title {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: var(--color-secondary);
	}
	.profile-section__note {
		font-size: 11px;
		color: var(--fg-3);
		text-align: right;
	}
	.profile-section__body {
		padding: 16px;
	}
</style>
