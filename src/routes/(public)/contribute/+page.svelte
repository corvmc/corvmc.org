<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Hero from '#lib/components/public/Hero.svelte';
	import Tile from '#lib/components/public/Tile.svelte';
	import Section from '#lib/components/public/Section.svelte';
	import SectionHeading from '#lib/components/public/SectionHeading.svelte';
	import {
		IconBuildingCommunity,
		IconCoin,
		IconGuitarPick,
		IconMicrophone,
		IconSpeakerphone,
		IconTicket
	} from '@tabler/icons-svelte';
	import type { Icon } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { signInHref } from '#lib/utils/sign-in.js';
	import { getPublicCommittees } from '#lib/remote/committees.remote.js';
	import WishlistSection from './WishlistSection.svelte';

	type VolunteerGroup = {
		icon: Icon;
		title: string;
		/** Only the committees group needs a lead-in above its roles. */
		desc?: string;
		roles: { name: string; desc: string }[];
		/** A door of its own, where the page's shared signup button is the wrong one. */
		link?: { href: string; label: string };
	};

	type ContributeWay = {
		icon: Icon;
		title: string;
		desc: string;
		href: string;
		cta: string;
		/** Opens in a new tab; set for links that leave the site. */
		external?: boolean;
	};

	// Registration, then straight to the page with the role checkboxes. This
	// replaced a Google Form, which forced a Google sign-in on respondents —
	// we'd rather ask for a free account of our own than someone else's.
	const VOLUNTEER_SIGNUP_URL = signInHref({ register: true, returnTo: '/member/volunteer' });

	// Zeffy's hosted donation form (zero-fee for nonprofits). Distinct from the
	// `/embed/...` variant, which is the bare iframe payload meant for embedding.
	const ZEFFY_DONATION_URL =
		'https://www.zeffy.com/donation-form/donate-to-the-corvallis-music-collective';

	// The committees are `group` rows with a staff-editable `bio`, and that bio
	// is the canonical remit — the literal list here went stale within a week
	// of #1149 renaming one of them by hand (#1167).
	const committees = $derived(await getPublicCommittees());

	const volunteerGroups: VolunteerGroup[] = $derived([
		{
			icon: IconTicket,
			title: m.public_contribute_at_shows(),
			desc: m.public_contribute_show_night_jobs_start_finish(),
			roles: [
				{ name: 'Host', desc: m.public_contribute_welcome_bands_introduce_sets_keep() },
				{ name: 'Tech', desc: m.public_contribute_operate_soundboard_run_soundcheck() },
				{ name: 'Door', desc: m.public_contribute_handle_entry_welcome_audience_keep() },
				{ name: 'Merch', desc: m.public_contribute_run_cmc_merch_concessions_coordinate() },
				{ name: 'Photo/Video', desc: m.public_contribute_document_show_with_own_equipment() }
			]
		},
		{
			icon: IconSpeakerphone,
			title: m.public_contribute_away_from_shows(),
			desc: m.public_contribute_keeping_place_running_between_events(),
			roles: [
				{ name: 'Street team', desc: m.public_contribute_put_up_posters_around_town() },
				{ name: 'Tabling', desc: m.public_contribute_staff_table_at_festivals_community() },
				{ name: 'Work parties', desc: m.public_contribute_cleaning_organizing_building_projects() },
				{ name: 'Gear repair', desc: m.public_contribute_clean_maintain_repair_lending_library() },
				{ name: 'Audio engineering', desc: m.public_contribute_help_members_record_mix_master() }
			]
		},
		{
			icon: IconBuildingCommunity,
			title: m.public_committees(),
			desc: m.public_contribute_committees_meet_monthly_build_guide(),
			roles: committees.map((c) => ({ name: c.name, desc: c.bio ?? '' })),
			// Committees are not volunteer roles any more, so the shift signup at the
			// foot of this section is the wrong door for them. Members apply.
			link: { href: '/member/groups', label: m.public_contribute_label() }
		}
	]);

	const otherWays: ContributeWay[] = [
		{
			icon: IconCoin,
			title: m.public_contribute_one_time_donation(),
			desc: m.public_contribute_not_ready_commit_monthly_one(),
			href: ZEFFY_DONATION_URL,
			cta: 'Donate Now',
			external: true
		},
		{
			icon: IconGuitarPick,
			title: m.public_contribute_donate_gear(),
			desc: m.public_contribute_working_amps_drums_mics_instruments(),
			href: '/contact',
			cta: 'Offer Gear'
		},
		{
			icon: IconMicrophone,
			title: m.public_contribute_host_workshop(),
			desc: m.public_contribute_share_craft_with_other_musicians(),
			href: '/contact',
			cta: 'Pitch an Idea'
		}
	];
</script>

<svelte:head>
	<title>{m.public_contribute_contribute_corvallis_music_collective()}</title>
	<meta
		name="description"
		content="Volunteer with the Corvallis Music Collective. Shows are run by volunteers — no experience needed, and a free account is all it takes to start. You can also become a sustaining member, donate gear, or make a gift."
	/>
</svelte:head>

<!-- Hero -->
<Hero title={m.public_contribute_help_us_keep_music_going()}>
	{m.public_contribute_cmc_501_c_3_nonprofit()}
</Hero>

<!--
	Volunteering leads the page: it's the ask with the lowest barrier and the one
	the collective depends on most. The role list mirrors the one on
	/member/volunteer, where the boxes actually get ticked, so someone can decide
	what they're interested in before making an account.

	Every mention of signing up says "free" out loud. The sustaining membership
	section directly below opens at $10/month, and without the word an unqualified
	"sign up" reads as "pay us" to anyone skimming.
-->
<Section>
	<div class="measure-center mb-12">
		<h2 class="text-4xl font-bold tracking-tight">{m.public_contribute_volunteer_with_us()}</h2>
		<p class="text-base leading-relaxed text-fg-2">
			{m.public_contribute_volunteers_beating_heart_our_organization()}
		</p>
	</div>

	<div class="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
		{#each volunteerGroups as group (group.title)}
			<Tile align="stack">
				<div class="flex items-center gap-2 text-cmc-navy">
					<group.icon size={24} />
					<h3 class="text-lg font-bold">{group.title}</h3>
				</div>
				{#if group.desc}
					<p class="text-sm leading-relaxed text-fg-3">{group.desc}</p>
				{/if}
				<ul class="flex flex-col gap-2">
					{#each group.roles as role (role.name)}
						<li class="text-sm leading-relaxed">
							<span class="font-bold">{role.name}</span>
							{#if role.desc}
								<span class="text-fg-2"> — {role.desc}</span>
							{/if}
						</li>
					{/each}
				</ul>
				{#if group.link}
					<Button href={group.link.href} variant="ghost" size="sm">{group.link.label}</Button>
				{/if}
			</Tile>
		{/each}
	</div>

	<div class="measure-center">
		<Button href={VOLUNTEER_SIGNUP_URL} variant="default" size="lg"
			>{m.public_contribute_create_free_account_volunteer()}</Button
		>
	</div>
</Section>

<!-- Become a Sustaining Member (pointer to /membership) -->
<section class="section-tint-secondary px-6 py-16">
	<div class="measure-center">
		<h2 class="text-4xl font-bold tracking-tight">{m.public_become_sustaining_member()}</h2>
		<p class="text-base leading-relaxed text-fg-2">
			{m.public_contribute_most_direct_way_support_space()}
		</p>
		<Button href="/membership" variant="default" size="lg"
			>{m.public_contribute_explore_membership()}</Button
		>
	</div>
</section>

<!--
	Its own boundary: the wishlist is not the page's load-bearing query, and a
	failure there should drop the section, not the page.
-->
<svelte:boundary>
	<WishlistSection />
	{#snippet failed()}{/snippet}
</svelte:boundary>

<!-- Other Ways to Contribute -->
<Section tint="warning">
	<SectionHeading title={m.public_contribute_other_ways_contribute()} />
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
		{#each otherWays as item (item.title)}
			<Tile fill="raised">
				<div class="text-cmc-navy">
					<item.icon size={40} />
				</div>
				<h3 class="text-lg font-bold">{item.title}</h3>
				<p class="text-muted leading-relaxed">{item.desc}</p>
				<Button
					href={item.href}
					variant="default"
					size="sm"
					class="mt-auto"
					target={item.external ? '_blank' : undefined}
					rel={item.external ? 'noopener noreferrer' : undefined}>{item.cta}</Button
				>
			</Tile>
		{/each}
	</div>
</Section>
