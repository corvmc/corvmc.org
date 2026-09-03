<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import { imageSrc } from '$lib/utils/images';

	type Photo = { id: string; url: string | null; altText: string | null; caption: string | null };

	/**
	 * The press shot, at a size a listings editor can actually use.
	 *
	 * Each links to its full-resolution original — an avatar is not a press
	 * photo, and the point of this section is that somebody can take the file
	 * away. Free acts hold one; a band site lifts the cap.
	 */
	let { photos = [] }: { photos?: Photo[] } = $props();

	const shown = $derived(photos.filter((p) => p.url));
</script>

{#if shown.length > 0}
	<ProfileSection title="Photos" note={shown.length > 1 ? `${shown.length} available` : undefined}>
		<div class="photos" class:photos--single={shown.length === 1}>
			{#each shown as photo (photo.id)}
				{@const shot = imageSrc(photo.url!, 'gallery')}
				<figure class="photos__item">
					<a href={photo.url} target="_blank" rel="external noopener noreferrer">
						<img
							src={shot.src}
							srcset={shot.srcset}
							sizes={shot.sizes}
							alt={photo.altText ?? ''}
							loading="lazy"
						/>
					</a>
					{#if photo.caption}
						<figcaption>{photo.caption}</figcaption>
					{/if}
				</figure>
			{/each}
		</div>
	</ProfileSection>
{/if}

<style>
	.photos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 10px;
	}
	.photos--single {
		grid-template-columns: 1fr;
	}
	.photos__item {
		margin: 0;
	}
	.photos__item img {
		width: 100%;
		border-radius: var(--radius-box, 8px);
		display: block;
	}
	.photos--single .photos__item img {
		max-height: 22rem;
		object-fit: cover;
	}
	.photos__item figcaption {
		margin-top: 4px;
		font-size: 11px;
		color: var(--fg-3);
	}
</style>
