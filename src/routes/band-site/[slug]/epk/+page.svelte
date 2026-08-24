<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { getBandSiteData } from '$lib/remote/band-site.remote';
	import { sanitizeBio } from '$lib/utils/markdown';
	import { page } from '$app/state';
	import { bandSiteHref } from '$lib/utils/band-site-url';
	import { imageSrc } from '$lib/utils/images';

	let data = $derived(await getBandSiteData(page.params.slug!));
	const band = $derived(data.band);
	const epk = $derived(data.config?.epk);
	const members = $derived(data.members);
	const events = $derived(data.events);
	const galleryMedia = $derived(data.media.filter((m) => m.type === 'image'));
	const stagePlot = $derived(data.media.find((m) => m.type === 'stage_plot'));
</script>

<svelte:head>
	<title>EPK — {band.name}</title>
	<style>
		@media print {
			.no-print {
				display: none !important;
			}
			body {
				font-size: 11pt;
			}
			.epk-page {
				padding: 0;
				max-width: 100%;
			}
			.page-break {
				page-break-before: always;
			}
			a {
				color: inherit;
				text-decoration: none;
			}
		}
	</style>
</svelte:head>

<!-- Print button (hidden in print) -->
<div class="no-print fixed top-4 right-4 z-50 flex gap-2">
	<Button variant="primary" size="sm" onclick={() => window.print()}>Download / Print PDF</Button>
	<Button href={bandSiteHref(band.slug, '', page.url)} variant="ghost" size="sm">
		&larr; Back
	</Button>
</div>

<div class="epk-page max-w-3xl mx-auto px-8 py-12 bg-white text-gray-900 min-h-screen">
	<!-- Header -->
	<header class="text-center pb-8 border-b-2 border-gray-200 mb-8">
		{#if band.avatarUrl}
			{@const avatar = imageSrc(band.avatarUrl, 'avatar-lg')}
			<img
				src={avatar.src}
				srcset={avatar.srcset}
				alt={band.name}
				class="w-28 h-28 rounded-full mx-auto mb-4 object-cover"
			/>
		{/if}
		<h1 class="text-4xl font-bold tracking-tight">{band.name}</h1>
		{#if band.tagline}
			<p class="text-lg text-gray-500 mt-1">{band.tagline}</p>
		{/if}
		{#if band.genres.length > 0}
			<p class="text-sm text-gray-400 mt-2">{band.genres.join(' · ')}</p>
		{/if}
		<p class="text-xs text-gray-400 mt-3 uppercase tracking-widest">Electronic Press Kit</p>
	</header>

	<!-- Bio -->
	{#if band.bio}
		<section class="mb-8">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">About</h2>
			<div class="prose prose-sm max-w-none text-gray-700 leading-relaxed">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (markdown bio) -->
				{@html sanitizeBio(band.bio)}
			</div>
		</section>
	{/if}

	<!-- Members -->
	{#if members.length > 0}
		<section class="mb-8">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Members</h2>
			<div class="flex flex-wrap gap-x-6 gap-y-1">
				{#each members as member (member.id)}
					<span class="text-gray-700">
						{member.name}{#if member.position}<span class="text-gray-400">
								— {member.position}</span
							>{/if}
					</span>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Press Quotes -->
	{#if epk?.pressQuotes && epk.pressQuotes.length > 0}
		<section class="mb-8">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Press</h2>
			<div class="space-y-3">
				{#each epk.pressQuotes as quote (quote.quote)}
					<blockquote class="border-l-2 border-gray-300 pl-4">
						<p class="text-gray-700 italic">"{quote.quote}"</p>
						<p class="text-sm text-gray-500 mt-1">
							— {quote.publication}
							{#if quote.date}<span class="text-gray-400">({quote.date})</span>{/if}
						</p>
					</blockquote>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Achievements -->
	{#if epk?.achievements && epk.achievements.length > 0}
		<section class="mb-8">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Highlights</h2>
			<ul class="space-y-1">
				{#each epk.achievements as achievement (achievement)}
					<li class="text-gray-700 flex items-start gap-2">
						<span class="text-gray-400">•</span>
						{achievement}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Gallery (first 6 photos) -->
	{#if galleryMedia.length > 0}
		<section class="mb-8 page-break">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Photos</h2>
			<div class="grid grid-cols-3 gap-2">
				{#each galleryMedia.slice(0, 6) as img (img.id)}
					{#if img.url}
						{@const shot = imageSrc(img.url, 'gallery')}
						<div class="aspect-square overflow-hidden rounded">
							<img
								src={shot.src}
								srcset={shot.srcset}
								sizes={shot.sizes}
								alt={img.caption ?? ''}
								class="w-full h-full object-cover"
							/>
						</div>
					{/if}
				{/each}
			</div>
			{#if galleryMedia.length > 6}
				<p class="text-xs text-gray-400 mt-2">
					{galleryMedia.length - 6} more photos available at {band.slug}.corvmc.org
				</p>
			{/if}
		</section>
	{/if}

	<!-- Upcoming Events -->
	{#if events.length > 0}
		<section class="mb-8">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Upcoming Shows</h2>
			<div class="space-y-1">
				{#each events.slice(0, 5) as evt (evt.id)}
					<div class="flex justify-between text-sm">
						<span class="text-gray-700 font-medium">{evt.title}</span>
						<span class="text-gray-500">{evt.location ?? ''}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Technical Requirements -->
	{#if epk?.backline && epk.backline.length > 0}
		<section class="mb-8 page-break">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
				Technical Requirements
			</h2>

			{#if stagePlot?.url}
				<img
					src={stagePlot.url}
					alt="Stage Plot"
					class="rounded mb-4 max-w-full max-h-64 object-contain"
				/>
			{/if}

			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-gray-200 text-left">
						<th class="py-1 font-semibold text-gray-600">Instrument</th>
						<th class="py-1 font-semibold text-gray-600">Details</th>
						<th class="py-1 font-semibold text-gray-600">Provided by</th>
					</tr>
				</thead>
				<tbody>
					{#each epk.backline as item (item.instrument)}
						<tr class="border-b border-gray-100">
							<td class="py-1 text-gray-700">{item.instrument}</td>
							<td class="py-1 text-gray-700">{item.details}</td>
							<td class="py-1 text-gray-500">{item.provided ? 'Band' : 'Venue'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}

	<!-- Links -->
	{#if band.links && band.links.length > 0}
		<section class="mb-8">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Links</h2>
			<div class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
				{#each band.links as link (link.url)}
					<a
						href={link.url}
						target="_blank"
						rel="noopener external"
						class="text-blue-600 hover:underline"
					>
						{link.label || link.url}
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Contact -->
	{#if epk?.bookingContact || epk?.managementContact || epk?.prContact}
		<section class="mt-8 pt-6 border-t-2 border-gray-200">
			<h2 class="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Contact</h2>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
				{#if epk.bookingContact}
					<div>
						<p class="font-semibold text-gray-600 text-xs uppercase">Booking</p>
						<p class="text-gray-700">{epk.bookingContact.name}</p>
						<p class="text-gray-500">{epk.bookingContact.email}</p>
						{#if epk.bookingContact.phone}
							<p class="text-gray-500">{epk.bookingContact.phone}</p>
						{/if}
					</div>
				{/if}
				{#if epk.managementContact}
					<div>
						<p class="font-semibold text-gray-600 text-xs uppercase">Management</p>
						<p class="text-gray-700">{epk.managementContact.name}</p>
						<p class="text-gray-500">{epk.managementContact.email}</p>
					</div>
				{/if}
				{#if epk.prContact}
					<div>
						<p class="font-semibold text-gray-600 text-xs uppercase">Press</p>
						<p class="text-gray-700">{epk.prContact.name}</p>
						<p class="text-gray-500">{epk.prContact.email}</p>
					</div>
				{/if}
			</div>
		</section>
	{/if}

	<!-- Footer -->
	<footer class="mt-12 pt-4 border-t border-gray-100 text-center text-xs text-gray-400">
		{band.name} &middot; {band.slug}.corvmc.org
	</footer>
</div>
