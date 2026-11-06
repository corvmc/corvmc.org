<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import InstructorCard from '#lib/components/directory/InstructorCard.svelte';
	import { resolve } from '$app/paths';
	import { getPublicInstructors } from '#lib/remote/instructors.remote.js';

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

	let instrument = $state('');

	const instructors = $derived(
		getPublicInstructors({
			search: searchText || undefined,
			instrument: instrument || undefined
		})
	);
</script>

<svelte:head>
	<title>{m.public_directory_instructors_music_teachers_corvallis_music()}</title>
	<meta
		name="description"
		content="Music teachers who give lessons at the Corvallis Music Collective."
	/>
</svelte:head>

<!-- `px-6` supplies what `PageHeader`'s `-mx-6` bleeds into; without it the
     header overhangs and the page scrolls sideways at 375px (#970). -->
<div class="px-6">
	<PageHeader title={m.public_teachers()} subtitle={m.public_directory_instructors_subtitle()} />

	<PageContent>
		<div class="mb-6 flex justify-center">
			<TabBar
				tabs={[
					{ key: 'bands', label: m.public_bands(), href: resolve('directory') },
					{
						key: 'musicians',
						label: m.public_musicians(),
						href: resolve('directory?tab=musicians')
					},
					{
						key: 'instructors',
						label: m.public_teachers(),
						href: resolve('directory/instructors')
					}
				]}
				active="instructors"
			/>
		</div>

		<div class="mb-8 flex justify-center">
			<FormField
				type="text"
				name="q"
				label={m.public_search()}
				class="w-full max-w-sm"
				placeholder={m.public_directory_instructors_placeholder()}
				bind:value={searchText}
			/>
		</div>

		<svelte:boundary>
			{@const page = await instructors}
			<!-- Built, tested and unwired until now: `filterSchema` has accepted
			     `instrument` and the SQL has implemented it all along (#1057). -->
			{#if page.instruments.length > 1}
				<div class="mb-6 flex flex-wrap justify-center gap-2">
					<Button
						size="sm"
						variant={instrument === '' ? 'primary' : 'default'}
						onclick={() => (instrument = '')}
					>
						{m.public_all()}
					</Button>
					{#each page.instruments as inst (inst)}
						<Button
							size="sm"
							variant={instrument === inst ? 'primary' : 'default'}
							onclick={() => (instrument = instrument === inst ? '' : inst)}
						>
							{inst}
						</Button>
					{/each}
				</div>
			{/if}

			{#if page.rows.length === 0}
				<EmptyState
					title={m.public_directory_instructors_no_teachers_listed_yet()}
					description={m.public_directory_instructors_description()}
				/>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each page.rows as row (row.userId)}
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

			{#snippet failed(_error, reset)}
				<Alert type="warning" reset={() => retryQuery(instructors, reset)}>
					{m.public_directory_instructors_list_teachers_didn_t_load()}
				</Alert>
			{/snippet}
		</svelte:boundary>
	</PageContent>
</div>
