<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityCard from './EntityCard.svelte';
	import EntityGallery from './EntityGallery.svelte';
	import DefinitionList from '../DefinitionList/DefinitionList.svelte';
	import Fact from '../DefinitionList/Fact.svelte';
	import Button from '../Button.svelte';
	import { fakeRef } from '$lib/test/fixtures';

	// Remote URLs, as IdCard.stories.svelte already uses: `imageSrc` passes
	// anything without the /cdn-cgi/image/ marker through untouched.
	const POSTER = 'https://picsum.photos/seed/loudnight/480/720';
	const POSTER_2 = 'https://picsum.photos/seed/matinee/480/720';
	const PORTRAIT = 'https://i.pravatar.cc/300?img=32';

	const { Story } = defineMeta({
		title: 'Shared/Entity/EntityCard',
		component: EntityCard,
		tags: ['autodocs'],
		parameters: {
			layout: 'padded',
			docs: {
				description: {
					component:
						'One record, expanded — what a *related* record looks like on someone ' +
						'else&apos;s detail page. Built on `Card`/`CardBody` rather than `InfoCard`, ' +
						'because an InfoCard&apos;s title is a section label whereas this card&apos;s ' +
						'title is the record itself.'
				}
			}
		},
		args: { ref: fakeRef('band', { id: 'band-1', status: 'active' }) }
	});
</script>

{#snippet plain()}
	<div class="max-w-md">
		<EntityCard ref={fakeRef('band', { id: 'band-1', status: 'active' })} />
	</div>
{/snippet}
<Story name="Default" template={plain} />

{#snippet withFacts()}
	<div class="max-w-md">
		<EntityCard ref={fakeRef('member', { id: 'm1', status: 'active' })}>
			{#snippet facts()}
				<DefinitionList>
					<Fact label="Pronouns" value="she/her" />
					<Fact label="Member since" value="2021" />
					<Fact label="Bands" value="The Velvet Underground" />
				</DefinitionList>
			{/snippet}
			{#snippet actions()}
				<Button variant="error" size="xs" outline>Deactivate</Button>
				<Button variant="primary" size="xs">Message</Button>
			{/snippet}
		</EntityCard>
	</div>
{/snippet}
<Story name="With facts and actions" template={withFacts} />

<!--
	A poster type turns the *whole card* portrait: full-bleed 2:3 artwork with the
	text underneath, the way a poster is actually looked at. The registry gives
	the event type `shape: 'poster'`, so `auto` picks it up without the call site
	asking. The third card has no artwork yet and keeps the same silhouette, so a
	listing grid stays even.
-->
{#snippet posters()}
	<div class="grid max-w-3xl gap-4 sm:grid-cols-3">
		<EntityCard ref={fakeRef('event', { id: 'e1', status: 'published', image: POSTER })} />
		<EntityCard
			ref={fakeRef('event', {
				id: 'e2',
				title: 'Sunday Matinee',
				subtitle: 'Sun, Mar 16 · 2:00 PM',
				status: 'published',
				image: POSTER_2
			})}
		/>
		<EntityCard ref={fakeRef('event', { id: 'e3', title: 'No Poster Yet', status: 'draft' })} />
	</div>
{/snippet}
<Story name="Event — the whole card is the poster" template={posters} />

<!--
	The no-image answer at both sizes. Initials on a generated pattern were the
	obvious fallback and the wrong one: on a card they spell out two letters of
	the title that is already printed beside them, and most of these types — a
	reservation, a report, a campaign — have no image to fall back *from*.
-->
{#snippet avatarVsIcon()}
	<div class="grid max-w-3xl gap-4 sm:grid-cols-2">
		<EntityCard ref={fakeRef('member', { id: 'm1', status: 'active', image: PORTRAIT })} />
		<EntityCard ref={fakeRef('member', { id: 'm2', status: 'active' })} />
		<EntityCard ref={fakeRef('band', { id: 'band-1', status: 'active' })} />
		<EntityCard ref={fakeRef('reservation', { id: 'r1', status: 'confirmed' })} />
	</div>
{/snippet}
<Story name="Photo vs. icon fallback" template={avatarVsIcon} />

{#snippet gallery()}
	<EntityGallery columns={1}>
		{#snippet item(type)}
			<EntityCard ref={fakeRef(type)} />
		{/snippet}
	</EntityGallery>
{/snippet}
<Story name="Gallery — every entity type" template={gallery} />

{#snippet unreachable()}
	<div class="max-w-md">
		<EntityCard ref={fakeRef('member', { id: null, subtitle: 'Account deleted' })} />
	</div>
{/snippet}
<Story name="Unreachable record" template={unreachable} />

<!--
	Status is exception-only, the same as subtypes. The left column is each
	record in its expected state and carries no ring and no corner mark at all;
	the right is the same record needing attention. If every healthy card were
	ringed, the one that matters would stop standing out.
-->
{#snippet statuses()}
	<div class="grid max-w-3xl gap-4 sm:grid-cols-2">
		<EntityCard ref={fakeRef('member', { id: 'm1', status: 'active' })} />
		<EntityCard ref={fakeRef('member', { id: 'm2', title: 'Sam Reyes', status: 'deactivated' })} />
		<EntityCard ref={fakeRef('reservation', { id: 'r1', status: 'confirmed' })} />
		<EntityCard
			ref={fakeRef('reservation', {
				id: 'r2',
				title: 'Mar 16, 7:00–9:00 PM',
				status: 'no_show'
			})}
		/>
		<EntityCard ref={fakeRef('equipment', { id: 'q1', status: 'available' })} />
		<EntityCard
			ref={fakeRef('equipment', { id: 'q2', title: 'Ampeg SVT', status: 'maintenance' })}
		/>
	</div>
{/snippet}
<Story name="Status — expected state vs needs attention" template={statuses} />

<!--
	Actions ride the bottom edge, half in and half out, the way the member
	reservation cards do. `.btn` already carries the retro hard shadow, so
	straddling the boundary is what makes them read as raised off the card.
	`size="xs"` throughout — a full-size button swamps the edge it sits on.

	The right-hand card is a poster, to check the treatment survives the taller
	portrait shape.
-->
{#snippet withActions()}
	<div class="grid max-w-3xl gap-6 sm:grid-cols-2">
		<EntityCard ref={fakeRef('reservation', { id: 'r1', status: 'scheduled' })}>
			{#snippet facts()}
				<DefinitionList>
					<Fact label="Booked by" value="Jane Doe" />
					<Fact label="Room" value="Practice space" />
				</DefinitionList>
			{/snippet}
			{#snippet actions()}
				<Button variant="error" size="xs" outline>Cancel</Button>
				<Button variant="primary" size="xs">Confirm</Button>
			{/snippet}
		</EntityCard>

		<EntityCard ref={fakeRef('event', { id: 'e1', status: 'draft', image: POSTER })}>
			{#snippet actions()}
				<Button variant="error" size="xs" outline>Delete</Button>
				<Button variant="primary" size="xs">Publish</Button>
			{/snippet}
		</EntityCard>
	</div>
{/snippet}
<Story name="Actions on the card edge" template={withActions} />
