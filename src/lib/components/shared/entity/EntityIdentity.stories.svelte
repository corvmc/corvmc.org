<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityIdentity from './EntityIdentity.svelte';
	import EntityGallery from './EntityGallery.svelte';
	import Table from '../Table.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import Button from '../Button.svelte';
	import { fakeRef } from '$lib/test/fixtures';

	const { Story } = defineMeta({
		title: 'Shared/Entity/EntityIdentity',
		component: EntityIdentity,
		tags: ['autodocs'],
		parameters: {
			layout: 'padded',
			docs: {
				description: {
					component:
						'One record&apos;s identity, at three scales. `sm` is the staff table ' +
						'**primary cell** — the shape hand-written 53 times across the panel; `md` ' +
						'is a standalone list row; `lg` is the strip at the top of a record&apos;s own ' +
						'page, which used to be a separate EntityHeader. It owns one cell&apos;s ' +
						'content and never the column set, the fetch, or the `<tr>`.'
				}
			}
		},
		args: { ref: fakeRef('member', { id: 'm1' }) }
	});

	// Left column is the ordinary case, deliberately unmarked.
	const subtypeSets = [
		{
			type: 'member' as const,
			rows: [
				[null, 'Jane Doe'],
				['sustaining', 'Ada Lovelace'],
				['staff', 'Justin Sheetz'],
				['admin', 'Devon Cash']
			]
		},
		{
			type: 'reservation' as const,
			rows: [
				[null, 'Mar 14, 7:00–9:00 PM'],
				['band', 'Mar 15, 6:00–8:00 PM'],
				['event', 'Mar 16, 5:00–11:00 PM'],
				['lesson', 'Mar 17, 4:00–5:00 PM']
			]
		},
		{
			type: 'event' as const,
			rows: [
				[null, 'Basement Show: Loud Night'],
				['band', 'The Velvet Underground live'],
				['community', 'Open Mic at the Library']
			]
		}
	];

	const members = [
		fakeRef('member', { id: 'm1' }),
		fakeRef('member', {
			id: 'm2',
			title: 'Justin Sheetz',
			subtitle: 'justin@example.dev',
			role: 'staff'
		}),
		fakeRef('member', {
			id: 'm3',
			title: 'Ada Lovelace',
			subtitle: 'ada@example.dev',
			sustaining: true
		})
	];
</script>

<!--
	`component:` is set for the autodocs props table, which means svelte-csf
	renders `<EntityIdentity {...args} />` *instead of* a story's children — the trap
	documented in DataList.stories.svelte. Bespoke stories pass a `template`.
-->

<!-- The staff table primary cell, in a real `cell-primary` — the only place the
     truncation contract is observable. -->
{#snippet inTable()}
	<Table>
		{#snippet head()}
			<th class="w-px"><span class="sr-only">Status</span></th>
			<th>Member</th>
			<th class="col-support whitespace-nowrap">Joined</th>
		{/snippet}
		{#each members as ref, i (ref.id)}
			<tr class="hover">
				<td class="w-px"><StatusBadge status="active" /></td>
				<td class="cell-primary"><EntityIdentity {ref} /></td>
				<td class="col-support whitespace-nowrap">Mar {10 + i}, 2025</td>
			</tr>
		{/each}
	</Table>
{/snippet}
<Story name="In a table cell" template={inTable} />

<!--
	BEFORE / AFTER. Left is the markup as it exists in the tree today —
	`staff/bands/+page.svelte`, `staff/events/+page.svelte` and eight more files,
	verbatim. Right is the component. They should be indistinguishable; this
	story is the evidence for that, rather than an assertion of it.
-->
{#snippet beforeAfter()}
	<div class="grid grid-cols-2 gap-8">
		<div>
			<p class="mb-2 text-subtle">Before — hand-written, ×10 files</p>
			<Table>
				{#snippet head()}<th>Member</th>{/snippet}
				<tr class="hover">
					<td class="cell-primary">
						<a href="#x" class="block truncate font-medium hover:underline">Jane Doe</a>
						<div class="truncate text-muted">jane@example.dev</div>
					</td>
				</tr>
			</Table>
		</div>
		<div>
			<p class="mb-2 text-subtle">After — &lt;EntityIdentity&gt;</p>
			<Table>
				{#snippet head()}<th>Member</th>{/snippet}
				<tr class="hover">
					<td class="cell-primary"><EntityIdentity ref={fakeRef('member', { id: 'm1' })} /></td>
				</tr>
			</Table>
		</div>
	</div>
{/snippet}
<Story name="Before / after — the primary cell" template={beforeAfter} />

<!-- Long content: the reason the anchor must stay a direct child of the cell. -->
{#snippet truncation()}
	<Table>
		{#snippet head()}
			<th>Event</th>
			<th class="col-support">Date</th>
		{/snippet}
		<tr class="hover">
			<td class="cell-primary">
				<EntityIdentity
					ref={fakeRef('event', {
						id: 'e1',
						title:
							'An Extremely Long Show Title That Should Be Clipped Rather Than Wrapping Onto A Second Line',
						subtitle: 'With a subtitle that is also far too long to fit in this column'
					})}
				/>
			</td>
			<td class="col-support whitespace-nowrap">Mar 14, 2025</td>
		</tr>
	</Table>
{/snippet}
<Story name="Truncation under pressure" template={truncation} />

<!-- The standalone list row: 40px avatar, its own flex wrapper. -->
{#snippet listRows()}
	<div class="flex max-w-md flex-col gap-2">
		<EntityIdentity ref={fakeRef('band', { id: 'band-1' })} size="md" />
		<EntityIdentity ref={fakeRef('member', { id: 'm1' })} size="md" />
		<EntityIdentity ref={fakeRef('event', { id: 'e1' })} size="md" />
	</div>
{/snippet}
<Story name="Size md — standalone list row" template={listRows} />

{#snippet gallery()}
	<EntityGallery columns={1}>
		{#snippet item(type)}
			<EntityIdentity ref={fakeRef(type)} size="md" />
		{/snippet}
	</EntityGallery>
{/snippet}
<Story name="Gallery — every entity type" template={gallery} />

<!-- Unreachable and deleted both render unlinked, and both keep their row. -->
{#snippet unlinked()}
	<div class="flex max-w-md flex-col gap-2">
		<EntityIdentity ref={fakeRef('member', { id: null, subtitle: 'Account deleted' })} size="md" />
		<EntityIdentity ref={fakeRef('flag')} size="md" />
	</div>
{/snippet}
<Story name="Unlinked states" template={unlinked} />

<!--
	Subtypes are exception-only. The first row of each group is the ordinary case
	and carries no glyph on purpose — `user` for a reservation and `cmc` for an
	event are as unmarked as a plain member. A marker on every row marks nothing.
	Hover a glyph for its label.
-->
{#snippet subtypes()}
	<div class="flex flex-col gap-6">
		{#each subtypeSets as set (set.type)}
			<div>
				<p class="mb-2 text-subtle">{set.type}</p>
				<div class="flex max-w-md flex-col gap-1">
					{#each set.rows as [subtype, title] (title)}
						<EntityIdentity ref={fakeRef(set.type, { id: title, subtype, title })} />
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/snippet}
<Story name="Subtypes — marked variants only" template={subtypes} />

<!--
	`lg` — the strip at the top of a record's own detail page. This was a separate
	`EntityHeader` until it became clear it was the same object as a row, one size
	up: same avatar convention, same subtype glyph, same status rule. It does not
	link, because the record's own page is where you already are.

	`email`/`phone` replace the subline: a detail strip wants to be actionable
	where a list row wants to be read.
-->
{#snippet detailStrip()}
	<div class="flex flex-col gap-8">
		<EntityIdentity
			ref={fakeRef('member', { id: 'm1', subtype: 'sustaining', status: 'active' })}
			size="lg"
			status
			email="jane@example.dev"
			phone="(541) 555-0134"
		>
			{#snippet qualifiers()}
				<span class="text-muted">#0142</span>
			{/snippet}
			{#snippet meta()}
				<Button variant="primary" size="xs">Message</Button>
			{/snippet}
		</EntityIdentity>

		<EntityIdentity
			ref={fakeRef('band', { id: 'band-1', status: 'active' })}
			size="lg"
			status
			email="book@vu.example"
		/>

		<!-- A noteworthy status gets the word at this size: there is one record on
		     the page, and room to say it. -->
		<EntityIdentity
			ref={fakeRef('member', { id: 'm2', title: 'Sam Reyes', status: 'deactivated' })}
			size="lg"
			status
			email="sam@example.dev"
		/>
	</div>
{/snippet}
<Story name="Size lg — a record's own detail strip" template={detailStrip} />

<!--
	The three scales together. Same component, same conventions — a member is
	round at every size, a subtype glyph marks the same records, and an ordinary
	status stays quiet throughout.
-->
{#snippet scales()}
	{@const ref = fakeRef('member', { id: 'm1', subtype: 'staff', status: 'active' })}
	<div class="flex flex-col gap-6">
		<div>
			<p class="mb-1 text-subtle">sm — table primary cell</p>
			<Table>
				{#snippet head()}<th>Member</th>{/snippet}
				<tr class="hover"><td class="cell-primary"><EntityIdentity {ref} /></td></tr>
			</Table>
		</div>
		<div>
			<p class="mb-1 text-subtle">md — list row</p>
			<EntityIdentity {ref} size="md" />
		</div>
		<div>
			<p class="mb-1 text-subtle">lg — detail strip</p>
			<EntityIdentity {ref} size="lg" status email="jane@example.dev" />
		</div>
	</div>
{/snippet}
<Story name="The three scales" template={scales} />
