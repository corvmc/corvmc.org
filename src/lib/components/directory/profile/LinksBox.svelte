<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import { detectPlatform } from '$lib/utils/link-platform';
	import {
		IconBrandYoutube,
		IconBrandSoundcloud,
		IconBrandSpotify,
		IconVinyl,
		IconBrandInstagram,
		IconBrandTiktok,
		IconBrandFacebook,
		IconBrandX,
		IconBrandApple,
		IconBrandAmazon,
		IconBrandGithub,
		IconBrandLinkedin,
		IconWorld,
		IconLink,
		IconExternalLink
	} from '@tabler/icons-svelte';
	import { partitionLinks } from '$lib/utils/directory-display';
	import type { ProfileLink } from '$lib/server/db/schema/authentication';

	let { links }: { links: ProfileLink[] } = $props();

	const iconMap: Record<string, typeof IconLink> = {
		IconBrandYoutube,
		IconBrandSoundcloud,
		IconBrandSpotify,
		IconVinyl,
		IconBrandInstagram,
		IconBrandTiktok,
		IconBrandFacebook,
		IconBrandX,
		IconBrandApple,
		IconBrandAmazon,
		IconBrandGithub,
		IconBrandLinkedin
	};

	type Resolved = { link: ProfileLink; name: string; icon: typeof IconLink };

	function resolve(link: ProfileLink): Resolved {
		const platform = detectPlatform(link.url);
		return {
			link,
			name: platform?.name ?? link.label ?? 'Link',
			icon: (platform && iconMap[platform.icon]) || IconWorld
		};
	}

	const partitioned = $derived(partitionLinks(links));
	const streaming = $derived(partitioned.streaming.map(resolve));
	const web = $derived(partitioned.web.map(resolve));
	const resolved = $derived([...streaming, ...web]);
</script>

{#if resolved.length > 0}
	<ProfileSection title="Links">
		<div class="links-box">
			{#if streaming.length > 0}
				<p class="links-box__group">Listen on</p>
				<div class="links-box__ribbon">
					{#each streaming as item (item.link.url)}
						{@const Icon = item.icon}
						<a
							href={item.link.url}
							target="_blank"
							rel="external noopener noreferrer"
							class="links-box__ico"
							title={item.name}
							aria-label={item.name}
						>
							<Icon size={18} />
						</a>
					{/each}
				</div>
			{/if}

			{#if web.length > 0}
				<p class="links-box__group">On the web</p>
				<div class="links-box__rows">
					{#each web as item (item.link.url)}
						{@const Icon = item.icon}
						<a
							href={item.link.url}
							target="_blank"
							rel="external noopener noreferrer"
							class="links-box__row"
						>
							<Icon size={16} class="links-box__row-ico" />
							<span class="links-box__row-label">{item.link.label || item.name}</span>
							<IconExternalLink size={14} class="links-box__row-out" />
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</ProfileSection>
{/if}

<style>
	.links-box {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.links-box__group {
		margin: 8px 0 2px;
		font-size: 9.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--fg-3);
	}
	.links-box__group:first-child {
		margin-top: 0;
	}
	.links-box__ribbon {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.links-box__ico {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border: 1px solid color-mix(in oklch, var(--cmc-brown) 26%, transparent);
		border-radius: var(--radius, 8px);
		background: var(--bg-card);
		color: var(--fg-1);
		transition: all 120ms ease;
	}
	.links-box__ico:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	.links-box__rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.links-box__row {
		display: grid;
		grid-template-columns: 16px 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid color-mix(in oklch, var(--cmc-brown) 26%, transparent);
		border-radius: var(--radius, 8px);
		background: var(--bg-card);
		color: var(--fg-1);
		font-size: 13px;
		transition: border-color 120ms ease;
	}
	.links-box__row:hover {
		border-color: var(--color-primary);
	}
	.links-box__row-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.links-box__row-out) {
		color: var(--fg-3);
	}
</style>
