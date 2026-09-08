<script lang="ts">
	import '$lib/themes/band-site/index.css';
	import { getBandSiteData } from '$lib/remote/band-site.remote';
	import { bandSitePath, bandSiteUrl } from '$lib/utils/band-site-url';
	import { env } from '$env/dynamic/public';
	import { page } from '$app/state';
	import { themeClass } from '$lib/utils/theme-starter';

	let { children } = $props();
	let data = $derived(await getBandSiteData(page.params.slug!));
	// `custom` means the band took a theme's rules over: no theme class applies
	// and their own CSS is the whole look.
	const containerClass = $derived(
		themeClass(data.config?.theme ?? 'default', data.config?.customCss)
	);

	const canonicalUrl = $derived(
		`${bandSiteUrl(page.params.slug!, env.PUBLIC_SITE_URL, data.band.customDomain)}${bandSitePath(page.params.slug!, page.url).replace(/\/$/, '')}`
	);
	const description = $derived(data.band.tagline || `${data.band.name} — official site`);
	const heroBlock = $derived(data.config?.blocks.find((b) => b.type === 'hero'));
	const ogImage = $derived(
		(heroBlock?.type === 'hero' ? heroBlock.imageKey : null) || data.band.avatarUrl
	);
</script>

<svelte:head>
	<title>{data.band.name}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={data.band.name} />
	<meta property="og:title" content={data.band.name} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonicalUrl} />
	{#if ogImage}
		<meta property="og:image" content={ogImage} />
		<meta name="twitter:card" content="summary_large_image" />
	{:else}
		<meta name="twitter:card" content="summary" />
	{/if}
</svelte:head>

<div class="band-site-container {containerClass} min-h-screen">
	{@render children()}

	{#if data.config?.customCss}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (admin custom CSS) -->
		{@html `<style>.band-site-container { ${data.config.customCss} }</style>`}
	{/if}
</div>
