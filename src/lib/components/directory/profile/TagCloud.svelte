<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';

	let {
		label,
		tags,
		variant
	}: {
		label: string;
		tags: string[];
		/** sticker-badge accent applied to all chips */
		variant?: 'teal' | 'orange';
	} = $props();

	const variantClass = $derived(variant ? `sticker-badge--${variant}` : '');
</script>

{#if tags.length > 0}
	<ProfileSection title={label}>
		<div class="tag-cloud">
			{#each tags as tag (tag)}
				<span class="sticker-badge sticker-badge--sm {variantClass}">{tag}</span>
			{/each}
		</div>
	</ProfileSection>
{/if}

<style>
	.tag-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
</style>
