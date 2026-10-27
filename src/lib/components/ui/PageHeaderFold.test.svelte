<!--
	Test harness for a header with more actions than a phone row holds, shaped like
	/staff/projects/[id] (#1910). `inline` passes all four as children, the way a
	page without a `menu` does; `folded` splits them into primary, children and menu.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import PageHeader from './PageHeader.svelte';
	import Button from './Button.svelte';
	import Action from './Action.svelte';

	let { shape }: { shape: 'inline' | 'folded' } = $props();

	const parent = { label: 'Projects', href: '/staff/projects' } as const;
</script>

{#snippet editProject()}
	<Action action={async () => undefined} label="Edit project" confirm="Edit it?" />
{/snippet}

{#snippet archive()}
	<Action action={async () => undefined} label="Archive" confirm="Archive it?" />
{/snippet}

<Tooltip.Provider delayDuration={300}>
	{#if shape === 'inline'}
		<PageHeader title="Folk Circle" subtitle="Events committee" {parent} documentTitle={null}>
			<Button variant="default" href="/budget">Budget</Button>
			<Action action={async () => undefined} label="Apply duty list" confirm="Apply it?" />
			{@render editProject()}
			<Button variant="ghost" shape="square" aria-label="More">•••</Button>
		</PageHeader>
	{:else}
		<PageHeader
			title="Folk Circle"
			subtitle="Events committee"
			{parent}
			documentTitle={null}
			primary={editProject}
			menu={archive}
		>
			<Button variant="default" href="/budget">Budget</Button>
			<Action
				action={async () => undefined}
				label="Apply duty list"
				variant="default"
				confirm="Apply it?"
			/>
		</PageHeader>
	{/if}
</Tooltip.Provider>
