<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Hero from '#lib/components/public/Hero.svelte';
	import Tile from '#lib/components/public/Tile.svelte';
	import Section from '#lib/components/public/Section.svelte';
	import {
		IconMusic,
		IconMicrophone,
		IconUsers,
		IconInfoCircle,
		IconBulb,
		IconGuitarPick
	} from '@tabler/icons-svelte';
	import Keyfob from '#lib/components/illustrations/Keyfob.svelte';
	import Ticket from '#lib/components/illustrations/Ticket.svelte';
	import Setlist from '#lib/components/illustrations/Setlist.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import { signInHref } from '#lib/utils/sign-in.js';
	import { getPublicGroups } from '#lib/remote/groups.remote.js';
	import GearDonationNote from './GearDonationNote.svelte';

	/**
	 * The cards below are hand-written copy; `/groups` is the live list. The link
	 * between them is gated on there being something to land on, because a
	 * "see all" that opens an empty directory is worse than no link at all.
	 */
	const publicGroups = $derived(await getPublicGroups());
</script>

<svelte:head>
	<title>{m.public_programs_programs_corvallis_music_collective_title()}</title>
	<meta
		name="description"
		content="Practice space, live events, meetups, and gear lending at the Corvallis Music Collective."
	/>
</svelte:head>

<!-- Hero -->
<Hero title={m.public_programs_programs_title()}
	>{m.public_programs_practice_spaces_performances_meetups_clubs_text()}</Hero
>

<!-- Practice Space -->
<Section tint="success" class="program-block">
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div>
			<span class="sticker-badge sticker-badge--teal" style="margin-bottom: 12px"
				>{m.public_practice_space_text()}</span
			>
			<h2 class="mt-3 mb-4 text-3xl leading-tight font-bold">
				{m.public_programs_affordable_practice_space_musicians_title()}
			</h2>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				{m.public_programs_our_practice_rooms_equipped_with_text()}
			</p>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				{m.public_programs_members_can_book_hourly_sessions_text()}
			</p>
			<Tile fill="tint-teal" pad="sm" align="start" class="mt-4">
				<IconInfoCircle size={20} class="mt-0.5 shrink-0 text-cmc-teal" />
				<p class="text-muted leading-relaxed">
					{m.public_programs_practice_space_access_requires_free_text()}
				</p>
			</Tile>
		</div>
		<div class="flex flex-col items-center justify-center">
			<Keyfob class="w-[clamp(120px,40%,200px)] -rotate-3" />
		</div>
	</div>
	<div class="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
		<div class="rounded-lg p-6 text-center surface">
			<div class="eyebrow-muted mb-2">{m.public_programs_standard_rate_text()}</div>
			<div class="text-4xl font-bold text-cmc-navy">{m.public_programs_15_hour_text()}</div>
			<div class="mt-1 text-muted">{m.public_programs_all_equipment_included_text()}</div>
		</div>
		<a
			href={signInHref({ register: true, returnTo: '/member' })}
			class="program-block__cta rounded-lg p-6 text-center tint-cmc-orange"
		>
			<div class="eyebrow-muted mb-2">{m.public_programs_sustaining_members_text()}</div>
			<div class="text-4xl font-bold text-cmc-orange">
				{m.public_programs_up_12_free_hours_text()}
			</div>
			<div class="mt-1 text-muted">{m.public_programs_every_month_then_15_hour_text()}</div>
		</a>
	</div>
</Section>

<!-- Gear Library & Rentals -->
<Section tint="secondary" class="program-block">
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div>
			<span class="sticker-badge sticker-badge--teal" style="margin-bottom: 12px"
				>{m.public_programs_gear_library_text()}</span
			>
			<h2 class="mt-3 mb-4 text-3xl leading-tight font-bold">
				{m.public_programs_borrow_gear_need_title()}
			</h2>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				{m.public_programs_cmc_maintains_gear_library_available_text()}
			</p>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				<ParaglideMessage
					message={m.public_programs_need_amp_gig_instrument_session_text}
					inputs={{}}
					>{#snippet a({ children })}<a href={resolve('contact')} class="link"
							>{@render children?.()}</a
						>{/snippet}</ParaglideMessage
				>
			</p>
			<Tile fill="tint-teal" pad="sm" align="start" class="mt-4">
				<IconGuitarPick size={20} class="mt-0.5 shrink-0 text-cmc-teal" />
				<GearDonationNote />
			</Tile>
		</div>
		<div class="grid grid-cols-1 gap-6 self-center sm:grid-cols-2">
			<div class="rounded-lg p-6 text-center surface">
				<div class="eyebrow-muted mb-2">{m.public_programs_instruments_amps_text()}</div>
				<div class="text-4xl font-bold text-cmc-navy">{m.public_programs_5_day_text()}</div>
				<div class="mt-1 text-muted">{m.public_programs_per_item_text()}</div>
			</div>
			<div class="rounded-lg p-6 text-center tint-cmc-orange">
				<div class="eyebrow-muted mb-2">{m.public_programs_cables_accessories_text()}</div>
				<div class="text-4xl font-bold text-cmc-orange">{m.public_programs_1_day_text()}</div>
				<div class="mt-1 text-muted">{m.public_programs_free_sustaining_members_text()}</div>
			</div>
		</div>
	</div>
</Section>

<!-- Shows & Performances -->
<Section tint="primary" class="program-block">
	<div class="mb-12 text-center">
		<span class="sticker-badge sticker-badge--orange" style="margin-bottom: 12px"
			>{m.public_programs_shows_text()}</span
		>
		<h2 class="mt-3 mb-3 text-4xl font-bold tracking-tight">
			{m.public_programs_shows_performances_title()}
		</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			{m.public_programs_showcase_talent_connect_with_community_text()}
		</p>
	</div>
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div>
			<h3 class="mb-3 text-2xl font-bold">{m.public_programs_perform_connect_title()}</h3>
			<p class="mb-4 text-base leading-relaxed text-fg-2">
				{m.public_programs_whether_re_seasoned_performer_just_text()}
			</p>
			<p class="mb-6 text-base leading-relaxed text-fg-2">
				{m.public_programs_from_intimate_acoustic_sets_full_text()}
			</p>
			<div class="flex flex-wrap gap-3">
				<Button href="/events" variant="default" class="program-block__cta"
					>{m.public_programs_view_upcoming_shows_label()}</Button
				>
				<Button href="/contact" variant="default" outline
					>{m.public_programs_apply_perform_label()}</Button
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
		<span class="sticker-badge" style="margin-bottom: 12px">{m.public_clubs_text()}</span>
		<h2 class="mt-3 mb-3 text-4xl font-bold tracking-tight">
			{m.public_programs_meetups_clubs_title()}
		</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			{m.public_programs_connect_with_like_minded_musicians_text()}
		</p>
	</div>
	<div class="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
		<div class="flex justify-center">
			<Setlist class="w-[clamp(200px,80%,340px)] -rotate-[1.4deg]" />
		</div>
		<div class="flex flex-col gap-5">
			<div class="rounded-lg p-6 tint-cmc-goldenrod">
				<div class="mb-3 flex items-center gap-3">
					<IconMusic size={24} class="text-cmc-navy" />
					<h3 class="text-xl font-bold">{m.public_programs_real_book_club_title()}</h3>
				</div>
				<p class="mb-3 text-muted leading-relaxed">
					{m.public_programs_our_flagship_jazz_jam_club_text()}
				</p>
				<Tile fill="tint-teal" pad="xs" align="start">
					<IconBulb size={18} class="mt-0.5 shrink-0 text-cmc-teal" />
					<p class="text-subtle leading-relaxed">
						{m.public_programs_bring_instrument_real_book_we_text()}
					</p>
				</Tile>
			</div>
			<div class="rounded-lg p-6 surface">
				<div class="mb-2 flex items-center gap-3">
					<IconUsers size={22} class="text-cmc-navy" />
					<h3 class="text-lg font-bold">{m.public_programs_songwriter_circle_title()}</h3>
				</div>
				<p class="mb-3 text-muted leading-relaxed">
					{m.public_programs_monthly_gathering_sharing_original_songs_text()}
				</p>
				<span class="sticker-badge sticker-badge--teal sticker-badge--sm"
					>{m.public_programs_2nd_saturday_2_00_pm_text()}</span
				>
			</div>
			<div class="rounded-lg p-6 surface">
				<div class="mb-2 flex items-center gap-3">
					<IconMicrophone size={22} class="text-cmc-navy" />
					<h3 class="text-lg font-bold">{m.public_programs_monthly_meetup_title()}</h3>
				</div>
				<p class="mb-3 text-muted leading-relaxed">
					{m.public_programs_come_chat_with_just_listen_text()}
				</p>
				<a
					href={resolve('events')}
					class="program-block__cta sticker-badge sticker-badge--orange sticker-badge--sm"
					>{m.public_programs_last_thursday_6_8_30_text()}</a
				>
			</div>
		</div>
	</div>
	{#if publicGroups.length > 0}
		<div class="mt-10 text-center">
			<Button href={resolve('groups')} variant="primary"
				>{m.public_programs_see_all_clubs_committees_label()}</Button
			>
		</div>
	{/if}
</Section>

<!-- Ready to Get Involved -->
<Section tint="primary">
	<div class="mb-12 text-center">
		<h2 class="mb-3 text-4xl font-bold tracking-tight">
			{m.public_programs_ready_get_involved_title()}
		</h2>
		<p class="mx-auto max-w-xl text-base leading-relaxed text-fg-2">
			{m.public_programs_join_corvallis_music_collective_access_text()}
		</p>
	</div>
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
		{#each [{ num: '1', title: m.public_programs_join_cmc_title(), desc: m.public_programs_become_member_access_all_programs_body(), badge: 'sticker-badge--teal' }, { num: '2', title: m.public_programs_choose_path_title(), desc: m.public_programs_practice_perform_join_our_clubs_body(), badge: 'sticker-badge--orange' }, { num: '3', title: m.public_programs_make_music_title(), desc: m.public_programs_connect_create_with_community_body(), badge: '' }] as step (step.num)}
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
		<Button href={signInHref({ register: true, returnTo: '/member' })} variant="default" size="lg"
			>{m.public_become_member_label()}</Button
		>
		<Button href="/contact" variant="default" outline
			>{m.public_programs_ask_questions_label()}</Button
		>
	</div>
</Section>
