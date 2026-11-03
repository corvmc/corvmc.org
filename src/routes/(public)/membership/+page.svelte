<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Hero from '$lib/components/public/Hero.svelte';
	import Tile from '$lib/components/public/Tile.svelte';
	import Section from '$lib/components/public/Section.svelte';
	import SectionHeading from '$lib/components/public/SectionHeading.svelte';
	import {
		IconClock,
		IconCalendarRepeat,
		IconTicket,
		IconDeviceSpeaker
	} from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import { signInHref } from '$lib/utils/sign-in';

	// Sustaining membership is a sliding scale: every $5/month earns one free hour
	// of practice time (up to 12), and every tier gets the same benefits. Kept in
	// sync with the member-facing pricing in SlidingScale.svelte and /contribute.
	const tiers = [
		{
			amount: '$10',
			hours: '2 free practice hours',
			body: 'A great way to start — and the practice time refreshes every month.',
			featured: false
		},
		{
			amount: '$25',
			hours: '5 free practice hours',
			body: 'Free gear accessories and invites to member-only events.',
			featured: true
		},
		{
			amount: '$60',
			hours: '12 free practice hours',
			body: 'The most practice time per dollar, with every member benefit included.',
			featured: false
		}
	];

	const benefits = [
		{
			icon: IconClock,
			title: m.public_membership_free_practice_hours(),
			desc: m.public_membership_monthly_allotment_free_rehearsal_time()
		},
		{
			icon: IconCalendarRepeat,
			title: m.public_membership_recurring_reservations(),
			desc: m.public_membership_lock_standing_weekly_practice_slot()
		},
		{
			icon: IconTicket,
			title: m.public_membership_member_events(),
			desc: m.public_membership_invites_member_only_events_show()
		},
		{
			icon: IconDeviceSpeaker,
			title: m.public_membership_gear_perks(),
			desc: m.public_membership_free_accessory_loans_reduced_rates()
		}
	];
</script>

<svelte:head>
	<title>{m.public_membership_membership_corvallis_music_collective()}</title>
	<meta
		name="description"
		content="A free account gets you started at the Corvallis Music Collective. Sustaining membership is a sliding-scale monthly contribution that supports the space and unlocks free practice hours and more."
	/>
</svelte:head>

<!-- Hero -->
<Hero title={m.public_become_member()}>
	{m.public_membership_free_account_gets_door_sustaining()}
</Hero>

<!-- Free vs Sustaining -->
<Section>
	<div class="mb-10 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight">{m.public_membership_two_ways_belong()}</h2>
		<p class="mx-auto max-w-2xl text-base leading-relaxed text-fg-2">
			{m.public_membership_everyone_starts_with_free_account()}
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
		<!-- Free -->
		<Tile align="stack" gap="4" pad="lg">
			<div>
				<div class="text-3xl font-bold">{m.public_membership_free_account()}</div>
				<div class="text-sm text-fg-3">{m.public_membership_always_free()}</div>
			</div>
			<p class="text-muted leading-relaxed">
				{m.public_membership_create_account_use_basics_book()}
			</p>
			<ul class="space-y-2 text-muted">
				<li>{m.public_membership_reserve_practice_space_hourly()}</li>
				<li>{m.public_membership_member_directory_access()}</li>
				<li>{m.public_membership_rsvp_events()}</li>
			</ul>
			<Button
				href={signInHref({ register: true, returnTo: '/member' })}
				variant="default"
				outline
				class="mt-auto">{m.public_membership_create_account()}</Button
			>
		</Tile>

		<!-- Sustaining -->
		<Tile align="stack" gap="4" pad="lg" fill="navy">
			<div>
				<div class="text-3xl font-bold">{m.public_membership_sustaining_member()}</div>
				<div class="text-sm" style="opacity: 0.85">
					{m.public_membership_from_10_month_sliding_scale()}
				</div>
			</div>
			<p class="text-sm leading-relaxed" style="opacity: 0.9">
				{m.public_membership_recurring_contribution_supports_space_unlo()}
			</p>
			<ul class="space-y-2 text-sm" style="opacity: 0.9">
				<li>{m.public_membership_everything_free_account()}</li>
				<li>{m.public_membership_free_practice_hours_every_month()}</li>
				<li>{m.public_membership_recurring_reservations_2()}</li>
				<li>{m.public_membership_gear_perks_member_only_events()}</li>
			</ul>
			<Button
				href={signInHref({ register: true, returnTo: '/member/membership' })}
				variant="cmc-orange"
				size="sm"
				class="mt-auto"
			>
				{m.public_become_sustaining_member()}
			</Button>
		</Tile>
	</div>
</Section>

<!-- Benefits -->
<Section tint="secondary">
	<SectionHeading title={m.public_membership_what_sustaining_members_get()} />
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
		{#each benefits as item (item.title)}
			<Tile fill="raised">
				<div class="text-cmc-navy">
					<item.icon size={40} />
				</div>
				<h3 class="text-lg font-bold">{item.title}</h3>
				<p class="text-muted leading-relaxed">{item.desc}</p>
			</Tile>
		{/each}
	</div>
</Section>

<!-- Sliding scale tiers -->
<Section>
	<div class="mb-10 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight">
			{m.public_membership_pick_contribution()}
		</h2>
		<p class="mx-auto max-w-2xl text-base leading-relaxed text-fg-2">
			<ParaglideMessage
				message={m.public_membership_s_sliding_scale_every_earns}
				inputs={{ public_membership_5_month: m.public_membership_5_month() }}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
		{#each tiers as tier (tier.amount)}
			<Tile pad="lg" gap="none" fill={tier.featured ? 'orange' : 'surface'}>
				<div class="mb-1 text-5xl leading-none font-bold">{tier.amount}</div>
				<div class="mb-3 text-xs" style={tier.featured ? 'opacity: 0.85' : 'color: var(--fg-3)'}>
					{m.public_membership_per_month()}
				</div>
				<div
					class="mb-3 text-sm font-bold tracking-widest uppercase"
					style={tier.featured ? 'opacity: 0.95' : 'color: var(--cmc-teal)'}
				>
					{tier.hours}
				</div>
				<p
					class="mb-6 text-sm leading-relaxed"
					style={tier.featured ? 'opacity: 0.9' : 'color: var(--fg-2)'}
				>
					{tier.body}
				</p>
				<Button
					href={signInHref({ register: true, returnTo: '/member/membership' })}
					variant="default"
					size="sm"
					shape="wide"
					class="mt-auto"
					style={tier.featured
						? 'background: var(--cmc-navy); color: #fff; border-color: rgba(0,0,0,0.3)'
						: ''}
				>
					{m.public_become_member()}
				</Button>
			</Tile>
		{/each}
	</div>
	<p class="mt-8 text-center text-sm text-fg-3">
		<ParaglideMessage
			message={m.public_membership_not_looking_join_monthly_there}
			inputs={{
				public_membership_other_ways_support_collective:
					m.public_membership_other_ways_support_collective()
			}}
			>{#snippet a({ children })}<a href={resolve('/contribute')} class="text-cmc-teal underline"
					>{@render children?.()}</a
				>{/snippet}</ParaglideMessage
		>
	</p>
</Section>
