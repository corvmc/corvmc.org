<script lang="ts">
	import { getEmbedUrl } from '$lib/utils/link-platform';
	import type { ProfileLink } from '$lib/server/db/schema/authentication';

	let { links }: { links: ProfileLink[] } = $props();

	let embeddableLinks = $derived(
		links
			.filter((l) => l.embed !== false) // respect embed toggle (default to embed if not set)
			.map((l) => ({ ...l, embedUrl: getEmbedUrl(l.url) }))
			.filter((l): l is typeof l & { embedUrl: string } => !!l.embedUrl)
	);
</script>

{#if embeddableLinks.length > 0}
	<div class="flex flex-col gap-4">
		{#each embeddableLinks as link (link.url)}
			<div class="overflow-hidden rounded-lg">
				{#if link.label}
					<p class="mb-1 text-sm font-medium">{link.label}</p>
				{/if}
				<iframe
					src={link.embedUrl}
					title={link.label || 'Embedded media'}
					width="100%"
					height={link.embedUrl.includes('youtube') ? '315' : '166'}
					frameborder="0"
					allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
					allowfullscreen
					loading="lazy"
					class="rounded-lg"
				></iframe>
			</div>
		{/each}
	</div>
{/if}
