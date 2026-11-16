<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import { imageSrc } from '#lib/utils/images.js';
	import { fullDate } from '#lib/utils/format.js';

	let {
		recaps
	}: {
		recaps: {
			id: string;
			title: string;
			startsAt: Date;
			coverUrl: string | null;
			photoCount: number;
			excerpt: string | null;
		}[];
	} = $props();
</script>

<section class="recaps">
	<SectionLabel label={m.public_events_recent_recaps_label()} />
	<ul class="recaps__grid">
		{#each recaps as recap (recap.id)}
			{@const cover = imageSrc(recap.coverUrl, 'gallery')}
			<li>
				<a href="{resolve(`events/${recap.id}`)}#photos" class="recaps__card">
					<img src={cover.src} srcset={cover.srcset} sizes={cover.sizes} alt="" loading="lazy" />
					<span class="recaps__title">{recap.title}</span>
					<span class="recaps__meta">
						{fullDate(recap.startsAt)} · {recap.photoCount}
						{recap.photoCount === 1
							? m.public_events_recent_recaps_photo_text()
							: m.public_events_recent_recaps_photos_text()}
					</span>
					{#if recap.excerpt}<span class="recaps__excerpt">{recap.excerpt}</span>{/if}
				</a>
			</li>
		{/each}
	</ul>
</section>

<style>
	.recaps {
		margin-top: 3.5rem;
	}

	.recaps__grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.25rem;
	}

	@media (min-width: 768px) {
		.recaps__grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.recaps__card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.recaps__card img {
		aspect-ratio: 4 / 3;
		width: 100%;
		object-fit: cover;
		border-radius: 6px;
	}

	.recaps__title {
		font-weight: 600;
	}

	.recaps__card:hover .recaps__title {
		text-decoration: underline;
	}

	.recaps__meta {
		font-size: 0.85rem;
		color: var(--fg-2);
	}

	.recaps__excerpt {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 0.9rem;
	}
</style>
