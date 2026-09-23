<script lang="ts">
	import { resolve } from '$app/paths';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { imageSrc } from '$lib/utils/images';
	import { fullDate } from '$lib/utils/format';

	let {
		recaps
	}: {
		recaps: {
			id: string;
			title: string;
			startsAt: Date;
			coverUrl: string | null;
			photoCount: number;
		}[];
	} = $props();
</script>

<section class="recaps">
	<SectionLabel label="Recent recaps" />
	<ul class="recaps__grid">
		{#each recaps as recap (recap.id)}
			{@const cover = imageSrc(recap.coverUrl, 'gallery')}
			<li>
				<a href="{resolve(`/events/${recap.id}`)}#photos" class="recaps__card">
					<img src={cover.src} srcset={cover.srcset} sizes={cover.sizes} alt="" loading="lazy" />
					<span class="recaps__title">{recap.title}</span>
					<span class="recaps__meta">
						{fullDate(recap.startsAt)} · {recap.photoCount}
						{recap.photoCount === 1 ? 'photo' : 'photos'}
					</span>
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
</style>
