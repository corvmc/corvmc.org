<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import BadgeList from '$lib/components/ui/BadgeList.svelte';
	import EntityCard from '$lib/components/ui/entity/EntityCard.svelte';
	import { resolve } from '$app/paths';
	import type { getMemberDashboard } from '$lib/remote/users.remote';

	/**
	 * Who this member should meet, from the answer they already gave.
	 *
	 * The data arrives as a plain prop off the dashboard's one load-bearing
	 * query — `custom/no-concurrent-remote-queries` refuses a page that fans a
	 * second remote query out of a component, and past kit 2.64 that shape does
	 * not render at all.
	 */
	let { matches }: { matches: Awaited<ReturnType<typeof getMemberDashboard>>['matches'] } =
		$props();

	const title = $derived(
		matches.direction === 'members' ? 'Members looking for a band' : 'Bands looking for members'
	);

	/**
	 * The empty state is the other half of the feature, so it says which field is
	 * missing rather than "nothing found". A blank profile genuinely cannot be
	 * matched, which is the completeness ladder's one honest incentive — and a
	 * different question from `isProfileComplete`, whose bar is deliberately low
	 * because it backs an ambient nudge.
	 */
	const gapLabels: Record<(typeof matches.gaps)[number], string> = {
		lookingFor: 'whether you’re looking for a band or for members',
		instruments: 'the instruments you play',
		seekingInstruments: 'the instruments your project needs',
		genres: 'a genre or two'
	};

	const missing = $derived(matches.gaps.map((g) => gapLabels[g]));
	const missingSentence = $derived(
		missing.length <= 1
			? missing.join('')
			: `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
	);
</script>

<InfoCard title={matches.direction ? title : 'Find your people'}>
	{#if matches.matches.length === 0}
		<EmptyState
			message={missing.length > 0
				? `Add ${missingSentence} to your profile and we’ll suggest people to meet.`
				: 'Nothing to suggest yet. Check back once more members and bands have filled in what they’re after.'}
			actionLabel={missing.length > 0 ? 'Update your profile' : undefined}
			actionHref={missing.length > 0 ? '/member/profile' : undefined}
		/>
	{:else}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each matches.matches as match (match.ref.id)}
				<EntityCard ref={match.ref}>
					{#snippet facts()}
						<!-- The overlap that produced the suggestion, not a tag cloud: a
						     card that shows why it is here can be disagreed with. -->
						<div class="mt-2 space-y-1">
							<BadgeList items={match.sharedInstruments} variant="primary" max={3} wrap />
							<BadgeList items={match.sharedGenres} max={3} wrap />
						</div>
					{/snippet}
				</EntityCard>
			{/each}
		</div>

		{#if missing.length > 0}
			<p class="mt-3 text-subtle">
				Add {missingSentence} to your
				<a href={resolve('/member/profile')} class="link link-primary">profile</a>
				for closer matches.
			</p>
		{/if}
	{/if}
</InfoCard>
