<script lang="ts">
	import Hero from '$lib/components/shared/marketing/Hero.svelte';
	import Section from '$lib/components/shared/marketing/Section.svelte';
	import SectionHeading from '$lib/components/shared/marketing/SectionHeading.svelte';
	import {
		IconClock,
		IconCalendarRepeat,
		IconTicket,
		IconDeviceSpeaker
	} from '@tabler/icons-svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { resolve } from '$app/paths';

	// Sustaining membership is a sliding scale: every $5/month earns one free hour
	// of practice time (up to 12), and every tier gets the same benefits. Kept in
	// sync with the member-facing pricing in SlidingScale.svelte and /contribute.
	const tiers = [
		{
			amount: '$10',
			hours: '2 free practice hours',
			body: 'A great way to start — plus 50% off every show ticket you buy online.',
			featured: false
		},
		{
			amount: '$25',
			hours: '5 free practice hours',
			body: 'Free gear accessories, member events, and 50% off show tickets.',
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
			title: 'Free Practice Hours',
			desc: 'A monthly allotment of free rehearsal time that refreshes each billing cycle.'
		},
		{
			icon: IconCalendarRepeat,
			title: 'Recurring Reservations',
			desc: 'Lock in a standing weekly practice slot — a members-only perk.'
		},
		{
			icon: IconTicket,
			title: 'Show Discounts',
			desc: '50% off show tickets you buy online, plus invites to member-only events.'
		},
		{
			icon: IconDeviceSpeaker,
			title: 'Gear Perks',
			desc: 'Free accessory loans and reduced rates on major equipment from the lending library.'
		}
	];
</script>

<svelte:head>
	<title>Membership | Corvallis Music Collective</title>
	<meta
		name="description"
		content="A free account gets you started at the Corvallis Music Collective. Sustaining membership is a sliding-scale monthly contribution that supports the space and unlocks free practice hours and more."
	/>
</svelte:head>

<!-- Hero -->
<Hero title="Become a Member">
	A free account gets you in the door. Sustaining membership keeps the doors open — and unlocks free
	practice hours, recurring reservations, and member perks.
</Hero>

<!-- Free vs Sustaining -->
<Section>
	<div class="mb-10 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight">Two Ways to Belong</h2>
		<p class="mx-auto max-w-2xl text-base leading-relaxed text-fg-2">
			Everyone starts with a free account. Sustaining members chip in monthly to keep the collective
			running — and get more out of the space in return.
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
		<!-- Free -->
		<div class="flex flex-col gap-4 rounded-lg p-8 surface">
			<div>
				<div class="text-3xl font-bold">Free Account</div>
				<div class="text-sm text-fg-3">Always free</div>
			</div>
			<p class="text-muted leading-relaxed">
				Create an account to use the basics — book practice space at the standard hourly rate,
				browse the member directory, and RSVP to events.
			</p>
			<ul class="space-y-2 text-muted">
				<li>• Reserve practice space hourly</li>
				<li>• Member directory access</li>
				<li>• RSVP to events</li>
			</ul>
			<Button href="/login?register&redirect=/member" variant="default" outline class="mt-auto"
				>Create an Account</Button
			>
		</div>

		<!-- Sustaining -->
		<div
			class="flex flex-col gap-4 rounded-lg p-8"
			style="background: var(--cmc-navy); color: #fff"
		>
			<div>
				<div class="text-3xl font-bold">Sustaining Member</div>
				<div class="text-sm" style="opacity: 0.85">From $10/month · sliding scale</div>
			</div>
			<p class="text-sm leading-relaxed" style="opacity: 0.9">
				A recurring contribution that supports the space and unlocks the full set of member
				benefits. Change or cancel anytime.
			</p>
			<ul class="space-y-2 text-sm" style="opacity: 0.9">
				<li>• Everything in the free account</li>
				<li>• Free practice hours every month</li>
				<li>• Recurring reservations</li>
				<li>• Ticket discounts &amp; gear perks</li>
			</ul>
			<Button
				href={resolve('/login?register&redirect=/member/membership')}
				variant="default"
				size="sm"
				class="mt-auto"
				style="background: var(--cmc-orange); color: #fff; border-color: rgba(0,0,0,0.3)"
			>
				Become a Sustaining Member
			</Button>
		</div>
	</div>
</Section>

<!-- Benefits -->
<Section tint="secondary">
	<SectionHeading title="What Sustaining Members Get" />
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
		{#each benefits as item (item.title)}
			<div
				class="flex flex-col items-center gap-3 rounded-lg p-6 text-center"
				style="background: var(--surface); border: 1px solid var(--surface-border); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))"
			>
				<div class="text-cmc-navy">
					<item.icon size={40} />
				</div>
				<h3 class="text-lg font-bold">{item.title}</h3>
				<p class="text-muted leading-relaxed">{item.desc}</p>
			</div>
		{/each}
	</div>
</Section>

<!-- Sliding scale tiers -->
<Section>
	<div class="mb-10 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight">Pick Your Contribution</h2>
		<p class="mx-auto max-w-2xl text-base leading-relaxed text-fg-2">
			It's a sliding scale: every <strong>$5/month</strong> earns you another free hour of practice time
			— up to 12. Every tier gets the same member benefits, you just walk away with more practice hours.
			Change or cancel anytime.
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
		{#each tiers as tier (tier.amount)}
			<div
				class="flex flex-col items-center rounded-lg p-8 text-center"
				style={tier.featured
					? 'background: var(--cmc-orange); color: #fff'
					: 'background: var(--surface); border: 1px solid var(--surface-border)'}
			>
				<div class="mb-1 text-5xl leading-none font-bold">{tier.amount}</div>
				<div class="mb-3 text-xs" style={tier.featured ? 'opacity: 0.85' : 'color: var(--fg-3)'}>
					per month
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
					href={resolve('/login?register&redirect=/member/membership')}
					variant="default"
					size="sm"
					shape="wide"
					class="mt-auto"
					style={tier.featured
						? 'background: var(--cmc-navy); color: #fff; border-color: rgba(0,0,0,0.3)'
						: ''}
				>
					Become a Member
				</Button>
			</div>
		{/each}
	</div>
	<p class="mt-8 text-center text-sm text-fg-3">
		Not looking to join monthly? There are <a
			href={resolve('/contribute')}
			class="text-cmc-teal underline">other ways to support the collective</a
		>.
	</p>
</Section>
