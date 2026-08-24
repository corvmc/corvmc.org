<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityChip from './EntityChip.svelte';
	import EntityGallery from './EntityGallery.svelte';
	import { fakeRef } from '$lib/test/fixtures';
	import DefinitionList from '../DefinitionList/DefinitionList.svelte';
	import Fact from '../DefinitionList/Fact.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Entity/EntityChip',
		component: EntityChip,
		tags: ['autodocs'],
		parameters: {
			layout: 'padded',
			docs: {
				description: {
					component:
						'An inline reference to another record: type glyph + its distinctive name. ' +
						'Takes no `href` — it derives the one canonical page this viewer can reach. ' +
						'Use the **Viewer** and **Panel** toolbars above to watch the links change.'
				}
			}
		},
		args: { ref: fakeRef('member', { id: 'm1' }) }
	});

	const staffOnly = ['flag', 'campaign', 'audience', 'equipment', 'loan'] as const;
</script>

<!--
	Bespoke stories pass a `template` snippet. With `component:` set, svelte-csf
	renders `<EntityChip {...args} />` *instead of* a story's children — the same
	trap documented in DataList.stories.svelte.
-->

<Story name="Default" />
<Story name="Without the type glyph" args={{ icon: false }} />

<!-- The visual net for a duplicated or wrong icon: every type, side by side. -->
{#snippet gallery()}
	<EntityGallery>
		{#snippet item(type)}
			<EntityChip ref={fakeRef(type)} />
		{/snippet}
	</EntityGallery>
{/snippet}
<Story name="Gallery — every entity type" template={gallery} />

<!-- A deleted account still gets named; it just stops linking. -->
<Story name="Record is gone" args={{ ref: fakeRef('member', { id: null }) }} />

{#snippet truncation()}
	<div class="max-w-48 border border-dashed border-base-300 p-2">
		<EntityChip
			ref={fakeRef('event', {
				id: 'e1',
				title: 'An Extremely Long Show Title That Will Not Fit In This Column'
			})}
		/>
	</div>
{/snippet}
<Story name="Long title truncates" template={truncation} />

<!--
	Staff-only records. Switch the Viewer toolbar to "member" and every one of
	these stops being a link — there is no page for them to open.
-->
{#snippet staffOnlyStory()}
	<div class="flex flex-col items-start gap-2">
		{#each staffOnly as type (type)}
			<EntityChip ref={fakeRef(type)} />
		{/each}
	</div>
{/snippet}
<Story name="Staff-only records" template={staffOnlyStory} />

<!--
	Where a chip actually lives: inside a fact list and inside a sentence. Worth
	its own story because a contained chip has to sit in a line of text without
	pushing the leading around — the failure mode a bare link never had.
-->
{#snippet inContext()}
	<div class="flex max-w-lg flex-col gap-6">
		<DefinitionList>
			<Fact label="Type">Band profile</Fact>
			<Fact label="Content"><EntityChip ref={fakeRef('band', { id: 'band-1' })} /></Fact>
			<Fact label="Reason">Misleading info</Fact>
			<Fact label="Reported by"><EntityChip ref={fakeRef('member', { id: 'm1' })} /></Fact>
		</DefinitionList>

		<p>
			Reported by <EntityChip ref={fakeRef('member', { id: 'm1' })} /> against
			<EntityChip ref={fakeRef('band', { id: 'band-1' })} /> in connection with
			<EntityChip ref={fakeRef('event', { id: 'e1' })} />, which is still on the public guide.
		</p>
	</div>
{/snippet}
<Story name="In a fact list and in prose" template={inContext} />

<!--
	A cancelled show and a live one used to be pixel-identical, which made the
	chip quietly lie in the place it is most likely to be read in passing —
	mid-sentence, where nobody goes looking for a status column. Exception-only,
	so the first chip in each pair trails nothing.

	A trailing glyph rather than a tinted container: chips run several to a
	paragraph, and colouring the border would shout across the page to say one of
	them is off.
-->
{#snippet statuses()}
	<div class="flex max-w-lg flex-col items-start gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<EntityChip ref={fakeRef('event', { id: 'e1', status: 'published' })} />
			<EntityChip
				ref={fakeRef('event', { id: 'e2', title: 'Cancelled: Loud Night', status: 'cancelled' })}
			/>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<EntityChip ref={fakeRef('member', { id: 'm1', status: 'active' })} />
			<EntityChip
				ref={fakeRef('member', { id: 'm2', title: 'Sam Reyes', status: 'deactivated' })}
			/>
		</div>
		<!--
			Every tone the follower can take. Error and warning are loud because
			something is wrong; `cancelled` and `deactivated` stay neutral because an
			ended record is not a fault, and reddening them would make every closed
			thing look broken.
		-->
		<div class="flex flex-wrap items-center gap-2">
			<EntityChip ref={fakeRef('reservation', { id: 'r1', status: 'no_show' })} />
			<EntityChip
				ref={fakeRef('equipment', { id: 'q1', title: 'Ampeg SVT', status: 'maintenance' })}
			/>
			<EntityChip ref={fakeRef('event', { id: 'e3', title: 'Draft Show', status: 'draft' })} />
		</div>
		<p>
			The listing <EntityChip
				ref={fakeRef('event', { id: 'e2', title: 'Loud Night', status: 'cancelled' })}
			/> was pulled after the report was upheld.
		</p>
	</div>
{/snippet}
<Story name="Status — only when it needs attention" template={statuses} />
