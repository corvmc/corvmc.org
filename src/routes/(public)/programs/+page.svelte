<script lang="ts">
	import Hero from '$lib/components/shared/marketing/Hero.svelte';
	import Section from '$lib/components/shared/marketing/Section.svelte';
	import {
		IconMusic,
		IconMicrophone,
		IconUsers,
		IconInfoCircle,
		IconBulb,
		IconGuitarPick
	} from '@tabler/icons-svelte';
	import Keyfob from '$lib/components/illustrations/Keyfob.svelte';
	import Ticket from '$lib/components/illustrations/Ticket.svelte';
	import Setlist from '$lib/components/illustrations/Setlist.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Programs | Corvallis Music Collective</title>
	<meta
		name="description"
		content="Practice space, live events, meetups, and gear lending at the Corvallis Music Collective."
	/>
</svelte:head>

<!-- Hero -->
<Hero title="Programs">Practice spaces, performances, meetups & clubs for the music community</Hero>

<!-- Practice Space -->
<Section tint="success" class="program-block">
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div>
			<span class="sticker-badge sticker-badge--teal" style="margin-bottom: 12px"
				>Practice Space</span
			>
			<h2 class="mt-3 mb-4 text-3xl leading-tight font-bold">
				Affordable Practice Space for Musicians
			</h2>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				Our practice rooms are equipped with professional gear and designed for musicians who need a
				reliable space to rehearse, record demos, and develop their craft.
			</p>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				Members can book hourly sessions in our sound-treated practice room, complete with a PA
				system, microphones, a drum kit, backline, and our full gear library — included. Book
				online, show up, and play.
			</p>
			<div
				class="mt-4 flex items-start gap-3 rounded-lg p-4"
				style="background: color-mix(in oklch, var(--cmc-teal) 12%, var(--surface)); border: 1px solid color-mix(in oklch, var(--cmc-teal) 20%, transparent)"
			>
				<IconInfoCircle size={20} class="mt-0.5 shrink-0 text-cmc-teal" />
				<p class="text-muted leading-relaxed">
					Practice space access requires a free CMC membership.
				</p>
			</div>
		</div>
		<div class="flex flex-col items-center justify-center">
			<Keyfob class="w-[clamp(120px,40%,200px)] -rotate-3" />
		</div>
	</div>
	<div class="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
		<div class="rounded-lg p-6 text-center surface">
			<div class="mb-2 text-sm font-bold tracking-wider text-fg-3 uppercase">Standard Rate</div>
			<div class="text-4xl font-bold text-cmc-navy">$15/hour</div>
			<div class="mt-1 text-muted">All equipment included</div>
		</div>
		<a
			href={resolve('/login?register&redirect=/member')}
			class="program-block__cta rounded-lg p-6 text-center"
			style="background: color-mix(in oklch, var(--cmc-orange) 12%, var(--surface)); border: 1px solid color-mix(in oklch, var(--cmc-orange) 20%, transparent)"
		>
			<div class="mb-2 text-sm font-bold tracking-wider text-fg-3 uppercase">
				Sustaining Members
			</div>
			<div class="text-4xl font-bold text-cmc-orange">up to 12 Free Hours</div>
			<div class="mt-1 text-muted">every month, then $15/hour</div>
		</a>
	</div>
</Section>

<!-- Gear Library & Rentals -->
<Section tint="secondary" class="program-block">
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div>
			<span class="sticker-badge sticker-badge--teal" style="margin-bottom: 12px">Gear Library</span
			>
			<h2 class="mt-3 mb-4 text-3xl leading-tight font-bold">Borrow the Gear You Need</h2>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				CMC maintains a gear library available to every member — a drum kit, backline, and our full
				gear library are included in the practice space, and members can also rent equipment to take
				out.
			</p>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				Need an amp for a gig, an instrument for a session, or a speaker for an event? We don't have
				a full catalogue online yet — <a href={resolve('/contact')} class="link">reach out</a> and we'll
				tell you what we've got, or come by and take a look.
			</p>
			<div
				class="mt-4 flex items-start gap-3 rounded-lg p-4"
				style="background: color-mix(in oklch, var(--cmc-teal) 12%, var(--surface)); border: 1px solid color-mix(in oklch, var(--cmc-teal) 20%, transparent)"
			>
				<IconGuitarPick size={20} class="mt-0.5 shrink-0 text-cmc-teal" />
				<p class="text-muted leading-relaxed">
					Got gear collecting dust? We accept instrument and equipment donations in any condition —
					email <a href="mailto:contact@corvmc.org" class="link">contact@corvmc.org</a>.
				</p>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-6 self-center sm:grid-cols-2">
			<div class="rounded-lg p-6 text-center surface">
				<div class="mb-2 text-sm font-bold tracking-wider text-fg-3 uppercase">
					Instruments & Amps
				</div>
				<div class="text-4xl font-bold text-cmc-navy">$5/day</div>
				<div class="mt-1 text-muted">per item</div>
			</div>
			<div
				class="rounded-lg p-6 text-center"
				style="background: color-mix(in oklch, var(--cmc-orange) 12%, var(--surface)); border: 1px solid color-mix(in oklch, var(--cmc-orange) 20%, transparent)"
			>
				<div class="mb-2 text-sm font-bold tracking-wider text-fg-3 uppercase">
					Cables & Accessories
				</div>
				<div class="text-4xl font-bold text-cmc-orange">$1/day</div>
				<div class="mt-1 text-muted">free for sustaining members</div>
			</div>
		</div>
	</div>
</Section>

<!-- Shows & Performances -->
<Section tint="primary" class="program-block">
	<div class="mb-12 text-center">
		<span class="sticker-badge sticker-badge--orange" style="margin-bottom: 12px">Shows</span>
		<h2 class="mt-3 mb-3 text-4xl font-bold tracking-tight">Shows & Performances</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			Showcase your talent and connect with the community through our regular performance
			opportunities.
		</p>
	</div>
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div>
			<h3 class="mb-3 text-2xl font-bold">Perform & Connect</h3>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				Whether you're a seasoned performer or just starting out, our performance programs provide
				supportive environments to share your music with appreciative audiences.
			</p>
			<p class="mb-6 text-base leading-relaxed text-fg-2">
				From intimate acoustic sets to full band productions, we create spaces where musicians can
				grow, collaborate, and celebrate the power of live music.
			</p>
			<div class="flex flex-wrap gap-3">
				<Button href="/events" variant="default" class="program-block__cta"
					>View Upcoming Shows</Button
				>
				<Button
					href="/contact"
					variant="default"
					outline
					style="--btn-fill: transparent; border-color: var(--cmc-navy); color: var(--cmc-navy)"
					>Apply to Perform</Button
				>
			</div>
		</div>
		<div class="flex flex-col items-center justify-center">
			<Ticket class="w-[clamp(240px,85%,420px)] -rotate-2" />
		</div>
	</div>
</Section>

<!-- Meetups & Clubs -->
<Section tint="warning" class="program-block">
	<div class="mb-12 text-center">
		<span class="sticker-badge" style="margin-bottom: 12px">Clubs</span>
		<h2 class="mt-3 mb-3 text-4xl font-bold tracking-tight">Meetups & Clubs</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			Connect with like-minded musicians through our regular meetups, learning sessions, and
			specialty clubs.
		</p>
	</div>
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div class="flex justify-center">
			<Setlist class="w-[clamp(200px,80%,340px)] -rotate-[1.4deg]" />
		</div>
		<div class="flex flex-col gap-5">
			<div
				class="rounded-lg p-6"
				style="background: color-mix(in oklch, var(--cmc-goldenrod) 25%, var(--surface)); border: 1px solid color-mix(in oklch, var(--cmc-goldenrod) 30%, transparent)"
			>
				<div class="mb-3 flex items-center gap-3">
					<IconMusic size={24} class="text-cmc-navy" />
					<h3 class="text-xl font-bold">Real Book Club</h3>
				</div>
				<p class="mb-3 text-muted leading-relaxed">
					Our flagship jazz jam club where musicians of all levels come together to explore the
					Great American Songbook and beyond.
				</p>
				<div
					class="flex items-start gap-3 rounded-lg p-3"
					style="background: color-mix(in oklch, var(--cmc-teal) 10%, var(--surface)); border: 1px solid color-mix(in oklch, var(--cmc-teal) 15%, transparent)"
				>
					<IconBulb size={18} class="mt-0.5 shrink-0 text-cmc-teal" />
					<p class="text-subtle leading-relaxed">
						Bring your instrument and a Real Book (or we'll share!)
					</p>
				</div>
			</div>
			<div class="rounded-lg p-6 surface">
				<div class="mb-2 flex items-center gap-3">
					<IconUsers size={22} class="text-cmc-navy" />
					<h3 class="text-lg font-bold">Songwriter Circle</h3>
				</div>
				<p class="mb-3 text-muted leading-relaxed">
					Monthly gathering for sharing original songs, getting feedback, and collaborating on new
					material.
				</p>
				<span class="sticker-badge sticker-badge--teal sticker-badge--sm"
					>2nd Saturday &middot; 2:00 PM</span
				>
			</div>
			<div class="rounded-lg p-6 surface">
				<div class="mb-2 flex items-center gap-3">
					<IconMicrophone size={22} class="text-cmc-navy" />
					<h3 class="text-lg font-bold">Monthly Meetup</h3>
				</div>
				<p class="mb-3 text-muted leading-relaxed">
					Come chat with — or just listen to — other local musicians about gear, gigs, and
					everything music-related.
				</p>
				<a
					href={resolve('/events')}
					class="program-block__cta sticker-badge sticker-badge--orange sticker-badge--sm"
					>Last Thursday &middot; 6&ndash;8:30 PM</a
				>
			</div>
		</div>
	</div>
</Section>

<!-- Ready to Get Involved -->
<Section tint="primary">
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight">Ready to Get Involved?</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			Join the Corvallis Music Collective to access all our programs and connect with a vibrant
			community of musicians.
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
		{#each [{ num: '1', title: 'Join CMC', desc: 'Become a member to access all programs.', badge: 'sticker-badge--teal' }, { num: '2', title: 'Choose Your Path', desc: 'Practice, perform, or join our clubs.', badge: 'sticker-badge--orange' }, { num: '3', title: 'Make Music', desc: 'Connect and create with the community.', badge: '' }] as step (step.num)}
			<div class="flex flex-col items-center gap-3 text-center">
				<span
					class="sticker-badge {step.badge}"
					style="font-size: 18px; padding: 10px 18px; transform: rotate({step.num === '2'
						? '2'
						: step.num === '3'
							? '-1'
							: '-2'}deg)"
				>
					{step.num}
				</span>
				<h3 class="text-lg font-bold">{step.title}</h3>
				<p class="text-muted leading-relaxed">{step.desc}</p>
			</div>
		{/each}
	</div>
	<div class="mt-10 flex justify-center gap-4">
		<Button href="/login?register&redirect=/member" variant="default" size="lg"
			>Become a Member</Button
		>
		<Button
			href="/contact"
			variant="default"
			outline
			style="--btn-fill: transparent; border-color: var(--cmc-navy); color: var(--cmc-navy)"
			>Ask Questions</Button
		>
	</div>
</Section>
