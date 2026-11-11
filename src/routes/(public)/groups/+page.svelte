<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Hero from '#lib/components/public/Hero.svelte';
	import Section from '#lib/components/public/Section.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import { getPublicGroups } from '#lib/remote/groups.remote.js';

	/**
	 * The programs the Collective runs, for anyone.
	 *
	 * `visibility = 'public'` is the whole of the decision about what appears
	 * here, and staff make it per group — the same column a band's listing uses,
	 * which is why a club has a directory entry rather than a listing shape of
	 * its own.
	 *
	 * Filterable by kind, and nothing else: "Public directory filtering beyond
	 * kind and genre" is explicitly out of scope, and at the Collective's scale a
	 * handful of programs do not need ranking.
	 */
	const groups = $derived(await getPublicGroups());

	let kind = $state<'club' | 'committee' | ''>('');
	const shown = $derived(kind ? groups.filter((g) => g.kind === kind) : groups);

	const kindLabel = (k: string) => (k === 'committee' ? 'Committee' : 'Club');
</script>

<svelte:head>
	<title>{m.public_groups_groups_corvallis_music_collective_title()}</title>
	<meta
		name="description"
		content="Clubs and committees at the Corvallis Music Collective — jam nights, workshops, and the groups that keep the place running."
	/>
</svelte:head>

<Hero title={m.public_groups_title()}
	>{m.public_groups_clubs_committees_at_collective_how_text()}</Hero
>

<Section>
	{#if groups.length === 0}
		<EmptyState description={m.public_groups_description_body()} />
	{:else}
		<div class="mb-6 flex flex-wrap gap-2">
			<Button variant={kind === '' ? 'primary' : 'ghost'} size="sm" onclick={() => (kind = '')}>
				{m.public_all_label()}
			</Button>
			<Button
				variant={kind === 'club' ? 'primary' : 'ghost'}
				size="sm"
				onclick={() => (kind = 'club')}
			>
				{m.public_clubs_label()}
			</Button>
			<Button
				variant={kind === 'committee' ? 'primary' : 'ghost'}
				size="sm"
				onclick={() => (kind = 'committee')}
			>
				{m.public_committees_label()}
			</Button>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			{#each shown as g (g.id)}
				<Card>
					<CardBody>
						<div class="flex items-start justify-between gap-3">
							<a class="link text-lg font-bold" href={resolve(`groups/${g.slug}`)}>{g.name}</a>
							<Badge variant="ghost">{kindLabel(g.kind)}</Badge>
						</div>
						{#if g.bio}
							<p class="text-sm text-fg-2">{g.bio}</p>
						{/if}
						<p class="text-subtle">
							{g.memberCount}
							{g.memberCount === 1 ? m.public_member_text() : m.public_members_2_text()}
							{#if g.joinPolicy === 'open'}
								{m.public_groups_open_join_text()}
							{:else if g.joinPolicy === 'by_application'}
								{m.public_groups_accepting_applications_text()}
							{/if}
						</p>
					</CardBody>
				</Card>
			{/each}
		</div>
	{/if}
</Section>
