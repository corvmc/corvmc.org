<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import InstructorCard from '$lib/components/directory/InstructorCard.svelte';
	import { resolve } from '$app/paths';
	import { getPublicInstructors } from '$lib/remote/instructors.remote';

	/**
	 * Who teaches at the Collective — the public half of "be found as a teacher".
	 *
	 * A **sibling route** rather than a filter on `/directory`, because the reader
	 * is different: someone who found CMC from a search engine and has no account,
	 * not a member browsing bandmates. A query string is not a landing page, and
	 * the existing `teachesLessons` filter reads a self-declared flag that
	 * deliberately still means "anywhere" — a route whose entire content is
	 * "teaches at the Collective" cannot be a filter over a column meaning
	 * something else.
	 *
	 * **Unauthenticated**, which is the whole point: the finder is not a member.
	 * Every gate that makes that safe lives in `instructor-directory-service.ts`.
	 */
	let searchText = $state('');

	const instructors = $derived(getPublicInstructors({ search: searchText || undefined }));
</script>

<svelte:head>
	<title>Music teachers · Corvallis Music Collective</title>
	<meta
		name="description"
		content="Music teachers who give lessons at the Corvallis Music Collective."
	/>
</svelte:head>

<PageHeader title="Teachers" subtitle="Music lessons at the Collective" />

<PageContent>
	<div class="mb-6 flex justify-center">
		<TabBar
			tabs={[
				{ key: 'bands', label: 'Acts', href: resolve('/directory') },
				{ key: 'musicians', label: 'Musicians', href: resolve('/directory?tab=musicians') },
				{ key: 'instructors', label: 'Teachers', href: resolve('/directory/instructors') }
			]}
			active="instructors"
		/>
	</div>

	<div class="mb-8 flex justify-center">
		<FormField
			type="text"
			name="q"
			label="Search"
			class="w-full max-w-sm"
			placeholder="Search teachers by name…"
			bind:value={searchText}
		/>
	</div>

	<svelte:boundary>
		{#await instructors then rows}
			{#if rows.length === 0}
				<EmptyState
					title="No teachers listed yet"
					description="Nobody is currently taking students here. Check back, or get in touch."
				/>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each rows as row (row.userId)}
						<InstructorCard
							href="/directory/members/{row.userId}"
							name={row.name}
							image={row.image}
							pronouns={row.pronouns}
							headline={row.headline}
							blurb={row.blurb}
							ratesNote={row.ratesNote}
							bookingUrl={row.bookingUrl}
							instruments={row.instruments}
							contact={row.contact}
						/>
					{/each}
				</div>
			{/if}
		{/await}
	</svelte:boundary>
</PageContent>
