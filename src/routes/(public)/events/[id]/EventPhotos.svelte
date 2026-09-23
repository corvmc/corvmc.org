<script lang="ts">
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { imageSrc } from '$lib/utils/images';

	let {
		eventTitle,
		photos
	}: {
		eventTitle: string;
		photos: { id: string; url: string | null; altText: string | null; caption: string | null }[];
	} = $props();
</script>

<!-- `id="photos"` is the anchor a band shares and the recaps strip links to. -->
<section id="photos" class="recap">
	<SectionLabel label="Photos" />
	<ul class="recap__grid">
		{#each photos as photo (photo.id)}
			{#if photo.url}
				{@const shot = imageSrc(photo.url, 'gallery')}
				<li>
					<figure>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an image URL, not a route -->
						<a href={photo.url} rel="external" target="_blank">
							<img
								src={shot.src}
								srcset={shot.srcset}
								sizes={shot.sizes}
								alt={photo.altText ?? `Photo from ${eventTitle}`}
								loading="lazy"
							/>
						</a>
						{#if photo.caption}<figcaption>{photo.caption}</figcaption>{/if}
					</figure>
				</li>
			{/if}
		{/each}
	</ul>
</section>

<style>
	.recap {
		margin-top: 3rem;
		scroll-margin-top: 5rem;
	}

	.recap__grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	@media (min-width: 768px) {
		.recap__grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.recap img {
		aspect-ratio: 1;
		width: 100%;
		object-fit: cover;
		border-radius: 6px;
	}

	.recap figcaption {
		margin-top: 0.35rem;
		font-size: 0.85rem;
		color: var(--fg-2);
	}
</style>
