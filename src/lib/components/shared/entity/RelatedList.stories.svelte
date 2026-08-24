<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RelatedList from './RelatedList.svelte';
	import EntityIdentity from './EntityIdentity.svelte';
	import EmptyState from '../EmptyState.svelte';
	import Button from '../Button.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { fakeRef } from '$lib/test/fixtures';

	const bands = [
		fakeRef('band', { id: 'b1', subtitle: '4 active members' }),
		fakeRef('band', { id: 'b2', title: 'Half Past Never', subtitle: '3 active members' }),
		fakeRef('band', { id: 'b3', title: 'Cardboard Satellites', subtitle: '5 active members' })
	];

	/** Never settles, so the pending arm stays on screen to be looked at. */
	const pending = new Promise<typeof bands>(() => {});
	const failed = Promise.reject(new Error('D1_ERROR: no such table'));
	// Storybook logs an unhandled rejection otherwise, before the story mounts.
	failed.catch(() => {});

	const { Story } = defineMeta({
		title: 'Shared/Entity/RelatedList',
		component: RelatedList,
		tags: ['autodocs'],
		parameters: {
			layout: 'padded',
			docs: {
				description: {
					component:
						'A titled card whose body is one remote query — the &ldquo;related records&rdquo; ' +
						'section of a detail page. Each section loads independently, so a slow ' +
						'subscription lookup does not blank the reservations beside it. Promoted out of ' +
						'`staff/users/[id]/panels/AsyncCard.svelte`, which was already exactly this ' +
						'component, privately, in one route folder.'
				}
			}
		},
		args: { title: 'Bands', result: Promise.resolve(bands) }
	});
</script>

{#snippet loaded()}
	<div class="max-w-md">
		<RelatedList title="Bands" result={Promise.resolve(bands)}>
			{#snippet children(rows)}
				<ul class="flex flex-col gap-2">
					{#each rows as ref (ref.id)}
						<li class="rounded-box px-2 py-2 hover:bg-base-200">
							<EntityIdentity {ref} size="md" />
						</li>
					{/each}
				</ul>
			{/snippet}
		</RelatedList>
	</div>
{/snippet}
<Story name="Default" template={loaded} />

<!--
	The `{:catch}` arm is the reason this component exists rather than each panel
	writing its own `{#await}`. Without it a failed query renders an *empty* card,
	which is indistinguishable from "this record has none of these" — the bug the
	Payment Records card shipped with, and one nobody reports because it looks
	like an answer.
-->
{#snippet errored()}
	<div class="grid max-w-3xl gap-4 sm:grid-cols-2">
		<RelatedList title="Bands" result={failed}>
			<p>Never rendered.</p>
		</RelatedList>
		<RelatedList title="Bands" result={Promise.resolve([])}>
			<EmptyState title="Not in any bands" description="No band membership or invitation." />
		</RelatedList>
	</div>
{/snippet}
<Story name="Failed vs. genuinely empty" template={errored} />

<!--
	Empty states stay with the caller — "no bands" and "no payments" want
	different words, and half of them want a link out — which is why the right
	card above supplies its own rather than the component guessing one.
-->
{#snippet loading()}
	<div class="max-w-md">
		<RelatedList title="Payment records" result={pending}>
			<p>Never rendered.</p>
		</RelatedList>
	</div>
{/snippet}
<Story name="Loading" template={loading} />

<!--
	`header` replaces the whole title row, so a section can carry a link out or a
	count without the component growing a prop per affordance.
-->
{#snippet withHeader()}
	<div class="max-w-md">
		<RelatedList title="Bands" result={Promise.resolve(bands)}>
			{#snippet header(title)}
				<header class="flex items-center justify-between">
					<span class="card-title">{title}</span>
					<Button variant="ghost" size="xs">View all</Button>
				</header>
			{/snippet}
			{#snippet children(rows)}
				<ul class="flex flex-col gap-2">
					{#each rows as ref (ref.id)}
						<li class="rounded-box flex items-center gap-2 px-2 py-2 hover:bg-base-200">
							<EntityIdentity {ref} size="md" class="flex-1" />
							<StatusBadge status="active" label />
						</li>
					{/each}
				</ul>
			{/snippet}
		</RelatedList>
	</div>
{/snippet}
<Story name="With a header action" template={withHeader} />
