<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { sanitizeBio } from '#lib/utils/markdown.js';
	import ProfileSection from './ProfileSection.svelte';

	let {
		kind,
		markdown
	}: {
		kind: 'bio' | 'about';
		markdown?: string | null;
	} = $props();

	const html = $derived(markdown ? sanitizeBio(markdown) : '');
</script>

{#if html}
	<ProfileSection title={kind === 'bio' ? m.directory_profile_bio() : m.directory_profile_about()}>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (markdown prose via sanitizeBio) -->
		<div class="prose prose-sm max-w-none text-base-content/80">{@html html}</div>
	</ProfileSection>
{/if}
