<script lang="ts">
	import Hero from '$lib/components/public/Hero.svelte';
	import Section from '$lib/components/public/Section.svelte';
	import Tile from '$lib/components/public/Tile.svelte';
	import { IconMusic, IconMicrophone, IconHeartHandshake, IconSchool } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PosterCard from '$lib/components/events/PosterCard.svelte';
	import { getPublicEvents } from '$lib/remote/events.remote';

	let { upcoming } = $derived(await getPublicEvents());

	const features = [
		{
			icon: IconMusic,
			title: 'Practice Space',
			desc: 'Affordable hourly rehearsal space with professional equipment for bands and musicians.'
		},
		{
			icon: IconMicrophone,
			title: 'Live Events',
			desc: 'Regular concerts and showcases featuring local and touring musicians.'
		},
		{
			icon: IconHeartHandshake,
			title: 'Community',
			desc: 'Connecting musicians for collaboration, education, and mutual support.'
		},
		{
			icon: IconSchool,
			title: 'Education',
			desc: 'Workshops, masterclasses, and mentorship programs for musicians of all levels.'
		}
	];
</script>

<svelte:head>
	<title>Corvallis Music Collective</title>
	<meta
		name="description"
		content="Shared music resources, affordable practice space, and a supportive community for musicians in Corvallis, Oregon."
	/>
</svelte:head>

<Hero title="Building and Connecting Music Communities in Corvallis" tone="teal">
	We provide shared music resources, affordable practice space, and a supportive community for local
	musicians to grow, collaborate, and thrive together.

	{#snippet actions()}
		<Button href="/login?register&redirect=/member" variant="primary" shape="wide"
			>Join Our Community!</Button
		>
		<Button href="/about" variant="ghost" shape="wide">Learn More About Us</Button>
		<div class="mt-1 flex flex-wrap justify-center gap-2">
			{#each ['All-ages', 'Substance-free', 'NOTAFLOF', 'Volunteer-run'] as tag (tag)}
				<span class="sticker-badge sticker-badge--sm">{tag}</span>
			{/each}
		</div>
	{/snippet}
</Hero>

<!-- Upcoming Events -->
<Section>
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight text-cmc-teal">Upcoming Events</h2>
	</div>
	{#if upcoming.length > 0}
		<div class="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
			{#each upcoming as evt (evt.id)}
				<PosterCard
					href="/events/{evt.id}"
					title={evt.title}
					posterUrl={evt.posterUrl}
					startsAt={evt.startsAt}
					ticketingEnabled={evt.ticketingEnabled}
					ticketPrice={evt.ticketPrice}
					externalTicketUrl={evt.externalTicketUrl}
					tags={evt.tags}
				/>
			{/each}
		</div>
	{:else}
		<p class="text-center opacity-60">No upcoming events right now. Check back soon!</p>
	{/if}
	<div class="mt-8 text-center">
		<Button href="/events" variant="ghost">View All Events &rarr;</Button>
	</div>
</Section>

<!-- What We Do -->
<Section tint="secondary">
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight text-cmc-teal">What We Do</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			Supporting musicians and building community through various programs
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
		{#each features as item (item.title)}
			<Tile fill="raised">
				<div class="text-cmc-navy">
					<item.icon size={40} />
				</div>
				<h3 class="text-lg font-bold">{item.title}</h3>
				<p class="text-muted leading-relaxed">{item.desc}</p>
			</Tile>
		{/each}
	</div>
	<div class="mt-10 text-center">
		<Button href="/programs" variant="ghost">View All Programs &rarr;</Button>
	</div>
</Section>

<!-- Get Involved -->
<Section>
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight text-cmc-teal">Get Involved</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			Join our mission to support the local music community
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
		<Tile fill="orange">
			<h3 class="text-xl font-bold">Become a Member</h3>
			<p class="text-sm leading-relaxed" style="opacity: 0.9">
				Join our community of musicians and gain access to practice space, events, and networking
				opportunities.
			</p>
			<Button href="/login?register&redirect=/member" variant="cmc-navy" size="sm" class="mt-2"
				>Join Now</Button
			>
		</Tile>
		<Tile fill="navy">
			<h3 class="text-xl font-bold">Volunteer</h3>
			<p class="text-sm leading-relaxed" style="opacity: 0.9">
				Help us organize events, maintain our space, and support fellow musicians in our community.
			</p>
			<Button href="/contribute" variant="cmc-orange" size="sm" class="mt-2">Learn More</Button>
		</Tile>
		<Tile fill="light-blue">
			<h3 class="text-xl font-bold">Support Us</h3>
			<p class="text-sm leading-relaxed" style="opacity: 0.85">
				Your donation helps us provide affordable space and programs for the local music community.
			</p>
			<Button href="/contribute" variant="cmc-navy" size="sm" class="mt-2">Contribute</Button>
		</Tile>
	</div>
</Section>
