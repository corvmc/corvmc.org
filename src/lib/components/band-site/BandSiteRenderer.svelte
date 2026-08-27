<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import type { Block, BandEpk } from '$lib/server/db/schema/band-page';
	import { getEmbedUrl, detectPlatform } from '$lib/utils/link-platform';
	import { formatDate, formatTime, formatCents } from '$lib/utils/format';
	import { sanitizeBio } from '$lib/utils/markdown';
	import { bandSiteHref } from '$lib/utils/band-site-url';
	// NOTE: `block.imageKey` / `item.imageKey` already hold *resolved URLs* by the
	// time they reach this component — `band-site-blocks.ts` overwrites the field
	// in place. The name is a leftover from the DB column.
	import { imageSrc } from '$lib/utils/images';
	import BandContactForm from './BandContactForm.svelte';
	import { page } from '$app/state';

	interface BandData {
		name: string;
		bio: string | null;
		tagline: string | null;
		avatarUrl: string | null;
		links: Array<{ label: string; url: string; embed?: boolean }> | null;
		genres: string[];
	}

	interface ConfigData {
		theme: string;
		customCss: string | null;
		blocks: Block[];
		epk: BandEpk | null;
	}

	interface MemberData {
		id: string;
		name: string;
		image: string | null;
		position: string | null;
		role: string;
	}

	interface EventData {
		id: string;
		title: string;
		description: string | null;
		startsAt: Date;
		/** Null when unknown — common on backfilled band gigs. */
		endsAt: Date | null;
		location: string | null;
		externalTicketUrl: string | null;
		ticketPrice: number | null;
		posterUrl: string | null;
	}

	interface MediaData {
		id: string;
		url: string | null;
		type: string;
		caption: string | null;
	}

	let {
		band,
		config,
		members,
		events,
		pastEvents = [],
		media
	}: {
		band: BandData;
		config: ConfigData | null;
		members: MemberData[];
		events: EventData[];
		pastEvents?: EventData[];
		media: MediaData[];
	} = $props();

	const blocks = $derived(config?.blocks ?? []);
	const epk = $derived(config?.epk ?? null);

	// If no blocks configured, show a default layout
	const hasBlocks = $derived(blocks.length > 0);
</script>

{#if hasBlocks}
	<!-- Custom block layout -->
	{#each blocks as block (block.id)}
		<section class="band-site-block {block.cssClass ?? ''}">
			{#if block.type === 'hero'}
				<div class="band-site-hero relative h-64 overflow-hidden md:h-96">
					{#if block.imageKey}
						{@const heroImg = imageSrc(block.imageKey, 'hero')}
						<img
							src={heroImg.src}
							srcset={heroImg.srcset}
							sizes={heroImg.sizes}
							alt=""
							class="absolute inset-0 h-full w-full object-cover"
						/>
					{/if}
					<div
						class="absolute inset-0 flex flex-col items-center justify-center bg-black/40 px-4 text-center text-white"
					>
						{#if block.headline}
							<h1 class="text-4xl font-bold md:text-6xl">{block.headline}</h1>
						{/if}
						{#if block.subtitle}
							<p class="mt-2 text-xl opacity-80">{block.subtitle}</p>
						{/if}
					</div>
				</div>
			{:else if block.type === 'bio'}
				<div class="mx-auto max-w-3xl px-6 py-8">
					<div class="prose prose-lg">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized server-side (prepareBlocksForRender) -->
						{@html block.content}
					</div>
				</div>
			{:else if block.type === 'links'}
				{#if band.links && band.links.length > 0}
					<div class="mx-auto max-w-md px-6 py-8">
						<div class="flex flex-col gap-3">
							{#each band.links as link (link.url)}
								{@const platform = detectPlatform(link.url)}
								<Button
									href={link.url}
									target="_blank"
									rel="external noopener"
									variant="default"
									outline
									class="w-full justify-start gap-3"
								>
									{#if platform}
										<span class="opacity-70">{platform.name}</span>
									{/if}
									<span>{link.label || platform?.name || 'Link'}</span>
								</Button>
							{/each}
						</div>
					</div>
				{/if}
			{:else if block.type === 'members'}
				<div class="mx-auto max-w-3xl px-6 py-8">
					<h2 class="mb-4 text-2xl font-bold">Members</h2>
					<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
						{#each members as member (member.id)}
							<div class="text-center">
								<div class="placeholder avatar mb-2">
									<div class="w-16 rounded-full bg-neutral text-neutral-content">
										{#if member.image}
											{@const memberImg = imageSrc(member.image, 'avatar-sm')}
											<img
												src={memberImg.src}
												srcset={memberImg.srcset}
												alt={member.name}
												class="rounded-full"
											/>
										{:else}
											<span class="text-xl">{member.name.charAt(0)}</span>
										{/if}
									</div>
								</div>
								<p class="font-medium">{member.name}</p>
								{#if block.showPositions && member.position}
									<p class="text-muted">{member.position}</p>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{:else if block.type === 'events'}
				{#if events.length > 0}
					<div class="mx-auto max-w-3xl px-6 py-8">
						<h2 class="mb-4 text-2xl font-bold">Upcoming Shows</h2>
						<div class="space-y-3">
							{#each events.slice(0, block.limit ?? 10) as evt (evt.id)}
								<div class="flex items-start justify-between rounded-lg bg-base-200 p-4">
									<div>
										<p class="font-medium">{evt.title}</p>
										<p class="text-muted">
											{formatDate(evt.startsAt)} &middot; {formatTime(evt.startsAt)}
										</p>
										{#if evt.location}
											<p class="text-muted">{evt.location}</p>
										{/if}
										{#if evt.ticketPrice}
											<p class="text-muted">{formatCents(evt.ticketPrice)}</p>
										{/if}
									</div>
									{#if evt.externalTicketUrl}
										<Button
											href={evt.externalTicketUrl}
											target="_blank"
											rel="external noopener"
											variant="primary"
											size="sm"
										>
											Tickets
										</Button>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if block.showPast && pastEvents.length > 0}
					<div class="mx-auto max-w-3xl px-6 py-8">
						<h2 class="mb-4 text-2xl font-bold">Past Shows</h2>
						<div class="space-y-2">
							{#each pastEvents.slice(0, block.limit ?? 10) as evt (evt.id)}
								<div class="flex items-baseline gap-3 text-sm">
									<span class="shrink-0 tabular-nums opacity-60">{formatDate(evt.startsAt)}</span>
									<span class="font-medium">{evt.title}</span>
									{#if evt.location}
										<span class="truncate opacity-60">{evt.location}</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{:else if block.type === 'gallery'}
				{@const galleryImages =
					block.imageKeys.length > 0
						? block.imageKeys.map((url) => ({ url, caption: null as string | null }))
						: media
								.filter((m) => m.type === 'image')
								.map((m) => ({ url: m.url, caption: m.caption }))}
				<div class="mx-auto max-w-4xl px-6 py-8">
					<div class="grid grid-cols-2 gap-2 md:grid-cols-3">
						{#each galleryImages as img, i (img.url ?? i)}
							{#if img.url}
								{@const galleryImg = imageSrc(img.url, 'gallery')}
								<div class="aspect-square overflow-hidden rounded-lg">
									<img
										src={galleryImg.src}
										srcset={galleryImg.srcset}
										sizes={galleryImg.sizes}
										alt={img.caption ?? ''}
										class="h-full w-full object-cover"
									/>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{:else if block.type === 'embed'}
				{@const embedUrl = getEmbedUrl(block.url)}
				{#if embedUrl}
					<div class="mx-auto max-w-3xl px-6 py-4">
						<iframe
							src={embedUrl}
							title={block.platform}
							width="100%"
							height={block.url.includes('youtube') ? '400' : '166'}
							frameborder="0"
							allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
							allowfullscreen
							loading="lazy"
							class="rounded-lg"
						></iframe>
					</div>
				{/if}
			{:else if block.type === 'press'}
				{#if epk?.pressQuotes && epk.pressQuotes.length > 0}
					<div class="mx-auto max-w-3xl px-6 py-8">
						<h2 class="mb-4 text-2xl font-bold">Press</h2>
						<div class="space-y-4">
							{#each epk.pressQuotes as quote (quote.quote)}
								<blockquote class="border-l-4 border-primary pl-4">
									<p class="italic">"{quote.quote}"</p>
									<footer class="mt-1 text-muted">
										&mdash; {quote.publication}
										{#if quote.date}
											<span class="opacity-60">({quote.date})</span>
										{/if}
									</footer>
								</blockquote>
							{/each}
						</div>
					</div>
				{/if}
			{:else if block.type === 'achievements'}
				{#if epk?.achievements && epk.achievements.length > 0}
					<div class="mx-auto max-w-3xl px-6 py-8">
						<h2 class="mb-4 text-2xl font-bold">Highlights</h2>
						<ul class="space-y-2">
							{#each epk.achievements as achievement (achievement)}
								<li class="flex items-start gap-2">
									<span class="text-primary">&#9733;</span>
									<span>{achievement}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			{:else if block.type === 'contact'}
				{@const showForm = block.showForm ?? true}
				{#if showForm || epk?.bookingContact || epk?.managementContact || epk?.prContact}
					<div class="mx-auto max-w-3xl px-6 py-8">
						<h2 class="mb-4 text-2xl font-bold">Contact</h2>
						{#if epk?.bookingContact || epk?.managementContact || epk?.prContact}
							<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
								{#if epk.bookingContact}
									<div>
										<h3 class="text-muted font-semibold uppercase">Booking</h3>
										<p class="font-medium">{epk.bookingContact.name}</p>
										<a href="mailto:{epk.bookingContact.email}" class="link text-sm"
											>{epk.bookingContact.email}</a
										>
										{#if epk.bookingContact.phone}
											<p class="text-muted">{epk.bookingContact.phone}</p>
										{/if}
									</div>
								{/if}
								{#if epk.managementContact}
									<div>
										<h3 class="text-muted font-semibold uppercase">Management</h3>
										<p class="font-medium">{epk.managementContact.name}</p>
										<a href="mailto:{epk.managementContact.email}" class="link text-sm"
											>{epk.managementContact.email}</a
										>
									</div>
								{/if}
								{#if epk.prContact}
									<div>
										<h3 class="text-muted font-semibold uppercase">Press</h3>
										<p class="font-medium">{epk.prContact.name}</p>
										<a href="mailto:{epk.prContact.email}" class="link text-sm"
											>{epk.prContact.email}</a
										>
									</div>
								{/if}
							</div>
						{/if}
						{#if showForm}
							<BandContactForm slug={page.params.slug!} bandName={band.name} />
						{/if}
					</div>
				{/if}
			{:else if block.type === 'tech_rider'}
				<div class="mx-auto max-w-3xl px-6 py-8">
					<h2 class="mb-4 text-2xl font-bold">Technical Requirements</h2>
					{#if epk?.stagePlotKey}
						{@const stageMedia = media.find((m) => m.type === 'stage_plot')}
						{#if stageMedia?.url}
							<img src={stageMedia.url} alt="Stage Plot" class="mb-4 max-w-full rounded-lg" />
						{/if}
					{/if}
					{#if epk?.backline && epk.backline.length > 0}
						<h3 class="mb-2 font-semibold">Backline Requirements</h3>
						<div class="overflow-x-auto">
							<table class="table table-sm">
								<thead>
									<tr>
										<th>Instrument</th>
										<th>Details</th>
										<th>Provided by</th>
									</tr>
								</thead>
								<tbody>
									{#each epk.backline as item (item.instrument)}
										<tr>
											<td class="font-medium">{item.instrument}</td>
											<td>{item.details}</td>
											<td>{item.provided ? 'Band' : 'Venue'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
					{#if epk?.technicalRiderKey}
						{@const riderMedia = media.find((m) => m.type === 'rider')}
						{#if riderMedia?.url}
							<Button
								href={riderMedia.url}
								target="_blank"
								rel="external noopener"
								variant="default"
								size="sm"
								outline
								class="mt-4"
							>
								Download Full Tech Rider (PDF)
							</Button>
						{/if}
					{/if}
				</div>
			{:else if block.type === 'custom_html'}
				<div class="mx-auto max-w-4xl px-6 py-8">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized server-side (prepareBlocksForRender) -->
					{@html block.content}
				</div>
			{:else if block.type === 'merch'}
				<div class="mx-auto max-w-3xl px-6 py-8">
					<h2 class="mb-4 text-2xl font-bold">Merch</h2>
					<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
						{#each block.items as item (item.url)}
							<a href={item.url} target="_blank" rel="external noopener" class="group block">
								{#if item.imageKey}
									{@const merchImg = imageSrc(item.imageKey, 'gallery')}
									<div class="mb-2 aspect-square overflow-hidden rounded-lg">
										<img
											src={merchImg.src}
											srcset={merchImg.srcset}
											sizes={merchImg.sizes}
											alt={item.title}
											class="h-full w-full object-cover transition-transform group-hover:scale-105"
										/>
									</div>
								{/if}
								<p class="font-medium transition-colors group-hover:text-primary">{item.title}</p>
								{#if item.price}
									<p class="text-muted">{item.price}</p>
								{/if}
							</a>
						{/each}
					</div>
				</div>
			{:else if block.type === 'spacer'}
				<div class={block.height === 'sm' ? 'h-8' : block.height === 'md' ? 'h-16' : 'h-32'}></div>
			{/if}
		</section>
	{/each}
{:else}
	<!-- Default layout when no blocks are configured -->
	<div class="mx-auto max-w-3xl px-6 py-12">
		<div class="mb-8 text-center">
			{#if band.avatarUrl}
				{@const bandImg = imageSrc(band.avatarUrl, 'avatar-lg')}
				<img
					src={bandImg.src}
					srcset={bandImg.srcset}
					alt={band.name}
					class="mx-auto mb-4 h-24 w-24 rounded-full object-cover"
				/>
			{/if}
			<h1 class="text-4xl font-bold">{band.name}</h1>
			{#if band.tagline}
				<p class="mt-2 text-xl opacity-70">{band.tagline}</p>
			{/if}
			{#if band.genres.length > 0}
				<p class="mt-2 opacity-60">{band.genres.join(' / ')}</p>
			{/if}
		</div>

		{#if band.bio}
			<div class="prose prose-sm mb-8 max-w-none text-center text-base-content/80">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (markdown bio) -->
				{@html sanitizeBio(band.bio)}
			</div>
		{/if}

		{#if band.links && band.links.length > 0}
			<div class="mx-auto mb-8 max-w-sm space-y-3">
				{#each band.links as link (link.url)}
					{@const embedUrl = link.embed !== false ? getEmbedUrl(link.url) : null}
					{#if embedUrl}
						<iframe
							src={embedUrl}
							title={link.label}
							width="100%"
							height={embedUrl.includes('youtube') ? '315' : '166'}
							frameborder="0"
							allow="autoplay; clipboard-write; encrypted-media"
							allowfullscreen
							loading="lazy"
							class="rounded-lg"
						></iframe>
					{:else}
						{@const platform = detectPlatform(link.url)}
						<Button
							href={link.url}
							target="_blank"
							rel="external noopener"
							variant="default"
							outline
							class="w-full"
						>
							{link.label || platform?.name || 'Link'}
						</Button>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- Navigation footer -->
<nav class="mx-auto flex max-w-3xl justify-center gap-4 px-6 py-6 text-muted">
	{#if events.length > 0}
		<a
			href={bandSiteHref(page.params.slug!, '/events', page.url)}
			class="transition-opacity hover:opacity-100">All Events</a
		>
	{/if}
	{#if epk}
		<a
			href={bandSiteHref(page.params.slug!, '/epk', page.url)}
			class="transition-opacity hover:opacity-100">Press Kit</a
		>
	{/if}
</nav>
