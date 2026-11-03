<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Hero from '#lib/components/public/Hero.svelte';
	import Section from '#lib/components/public/Section.svelte';
	import Tile from '#lib/components/public/Tile.svelte';
	import { IconMusic, IconMicrophone, IconHeartHandshake, IconSchool } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PosterCard from '#lib/components/events/PosterCard.svelte';
	import { getPublicEvents } from '#lib/remote/events.remote.js';
	import { signInHref } from '#lib/utils/sign-in.js';

	const JOIN_HREF = signInHref({ register: true, returnTo: '/member' });

	let { upcoming } = $derived(await getPublicEvents());

	const features = [
		{
			icon: IconMusic,
			title: m.public_practice_space(),
			desc: m.public_affordable_hourly_rehearsal_space_with()
		},
		{
			icon: IconMicrophone,
			title: m.public_live_events(),
			desc: m.public_regular_concerts_showcases_featuring_local()
		},
		{
			icon: IconHeartHandshake,
			title: m.public_community(),
			desc: m.public_connecting_musicians_collaboration_education_mutual()
		},
		{
			icon: IconSchool,
			title: m.public_education(),
			desc: m.public_workshops_masterclasses_mentorship_programs_musicians()
		}
	];
</script>

<svelte:head>
	<title>{m.public_corvallis_music_collective()}</title>
	<meta
		name="description"
		content="Shared music resources, affordable practice space, and a supportive community for musicians in Corvallis, Oregon."
	/>
</svelte:head>

<Hero title={m.public_building_connecting_music_communities_corvallis()} tone="teal">
	{m.public_we_provide_shared_music_resources()}

	{#snippet actions()}
		<Button href={JOIN_HREF} variant="primary" shape="wide">{m.public_join_our_community()}</Button>
		<Button href="/about" variant="ghost" shape="wide">{m.public_learn_more_about_us()}</Button>
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
		<h2 class="mb-3 text-4xl font-bold tracking-tight text-cmc-teal">
			{m.public_upcoming_events()}
		</h2>
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
		<p class="text-center opacity-60">{m.public_no_upcoming_events_right_now()}</p>
	{/if}
	<div class="mt-8 text-center">
		<Button href="/events" variant="ghost">{m.public_view_all_events()}</Button>
	</div>
</Section>

<!-- What We Do -->
<Section tint="secondary">
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight text-cmc-teal">{m.public_what_we_do()}</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			{m.public_supporting_musicians_building_community_through()}
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
		<Button href="/programs" variant="ghost">{m.public_view_all_programs()}</Button>
	</div>
</Section>

<!-- Get Involved -->
<Section>
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight text-cmc-teal">{m.public_get_involved()}</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			{m.public_join_our_mission_support_local()}
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
		<Tile fill="orange">
			<h3 class="text-xl font-bold">{m.public_become_member()}</h3>
			<p class="text-sm leading-relaxed" style="opacity: 0.9">
				{m.public_join_our_community_musicians_gain()}
			</p>
			<Button href={JOIN_HREF} variant="cmc-navy" size="sm" class="mt-2"
				>{m.public_join_now()}</Button
			>
		</Tile>
		<Tile fill="navy">
			<h3 class="text-xl font-bold">{m.public_volunteer()}</h3>
			<p class="text-sm leading-relaxed" style="opacity: 0.9">
				{m.public_help_us_organize_events_maintain()}
			</p>
			<Button href="/contribute" variant="cmc-orange" size="sm" class="mt-2"
				>{m.public_learn_more()}</Button
			>
		</Tile>
		<Tile fill="light-blue">
			<h3 class="text-xl font-bold">{m.public_support_us()}</h3>
			<p class="text-sm leading-relaxed" style="opacity: 0.85">
				{m.public_donation_helps_us_provide_affordable()}
			</p>
			<Button href="/contribute" variant="cmc-navy" size="sm" class="mt-2"
				>{m.public_contribute()}</Button
			>
		</Tile>
	</div>
</Section>
