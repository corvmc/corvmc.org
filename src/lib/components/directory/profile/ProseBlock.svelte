<script lang="ts">
	import { sanitizeBio } from '$lib/utils/markdown';
	import ProfileSection from './ProfileSection.svelte';

	let {
		label,
		markdown
	}: {
		label: 'Bio' | 'About';
		markdown?: string | null;
	} = $props();

	const html = $derived(markdown ? sanitizeBio(markdown) : '');
</script>

{#if html}
	<ProfileSection title={label}>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (markdown prose via sanitizeBio) -->
		<div class="prose prose-sm max-w-none text-base-content/80">{@html html}</div>
	</ProfileSection>
{/if}
