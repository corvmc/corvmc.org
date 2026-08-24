<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
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
		IconBrandGithub,
		IconBrandLinkedin,
		IconLink
	} from '@tabler/icons-svelte';
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
		IconBrandGithub,
		IconBrandLinkedin
	};
</script>

{#if links.length > 0}
	<div class="flex flex-col gap-2">
		{#each links as link (link.url)}
			{@const platform = detectPlatform(link.url)}
			{@const IconComponent = platform ? (iconMap[platform.icon] ?? IconLink) : IconLink}
			<Button
				href={link.url}
				target="_blank"
				rel="external noopener noreferrer"
				variant="default"
				size="sm"
				outline
				class="justify-start gap-2"
			>
				<IconComponent size={18} />
				<span class="truncate">{link.label || platform?.name || 'Link'}</span>
			</Button>
		{/each}
	</div>
{/if}
