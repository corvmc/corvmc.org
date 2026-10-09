<script lang="ts">
	/**
	 * Move a production one step along the usual path.
	 *
	 * Page-local rather than in `$lib/components/actions/`: one page uses it.
	 * Warn, record, allow (docs/development/conventions.md#workflow-gates): a
	 * move that trips a warning comes back with it, and goes through with a
	 * reason. Anything off the usual path is in the overflow menu, deliberately
	 * quiet — it is an escape hatch, not a peer of these buttons.
	 */
	import { DropdownMenu } from 'bits-ui';
	import { IconDots } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { advanceProduction, reopenProduction } from '$lib/remote/productions.remote';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { hasCapability } from '$lib/config';
	import { isTerminalProduction } from '$lib/production/status';
	import type { ProductionStatus } from '$lib/server/db/schema/production';

	let {
		production,
		eventId
	}: {
		production: { id: string; status: ProductionStatus };
		eventId: string;
	} = $props();

	/** The usual path, forward one step, plus the walk-back a mis-click needs. */
	const NEXT: Partial<Record<ProductionStatus, { to: ProductionStatus; label: string }[]>> = {
		draft: [
			{ to: 'offered', label: 'Send the offer' },
			{ to: 'confirmed', label: 'Confirm' }
		],
		offered: [
			{ to: 'confirmed', label: 'Confirm' },
			{ to: 'draft', label: 'Pull the offer' }
		],
		confirmed: [{ to: 'completed', label: 'Mark it played' }],
		completed: [{ to: 'settled', label: 'Settle' }],
		settled: [{ to: 'closed', label: 'Close out' }]
	};

	const ALL: ProductionStatus[] = [
		'draft',
		'offered',
		'confirmed',
		'completed',
		'settled',
		'closed',
		'cancelled'
	];

	const moves = $derived(NEXT[production.status] ?? []);
	const canCancel = $derived(['draft', 'offered', 'confirmed'].includes(production.status));
	const terminal = $derived(isTerminalProduction(production.status));

	// The staff layout has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const canReopen = $derived(hasCapability(caps, 'production.reopen'));

	type Result = { conflict?: boolean; warnings?: string[] } | undefined;

	function done(result: unknown, message: string) {
		if ((result as Result)?.conflict) return false;
		toast.success(message);
		return true;
	}

	// The overflow menu's two dialogs.
	let setOpen = $state(false);
	let setTo = $state<ProductionStatus | ''>('');
	let warned = $state<{ to: string; warnings: string[] } | null>(null);
	let reopenOpen = $state(false);
	let reopenTo = $state<ProductionStatus>('settled');

	const override = advanceProduction.for('override');
	const setOptions = $derived(
		ALL.filter((s) => s !== production.status).map((s) => ({ value: s, label: s }))
	);
	const reopenOptions = ALL.filter((s) => !isTerminalProduction(s)).map((s) => ({
		value: s,
		label: s
	}));

	const itemClass =
		'flex w-full cursor-pointer items-center rounded-box px-3 py-2 text-sm data-highlighted:bg-base-200';
</script>

{#snippet warningsFor(result: Result)}
	{#if result?.conflict && result.warnings?.length}
		<ul class="list-disc space-y-1 pl-5 text-sm text-warning">
			{#each result.warnings as warning (warning)}
				<li>{warning}</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#each moves as move (move.to)}
	{@const step = advanceProduction.for(move.to)}
	<Action
		action={step}
		label={move.label}
		variant="ghost"
		size="sm"
		onsuccess={(r) => done(r, `Production ${move.to}`)}
	>
		{#snippet form()}
			<input {...step.fields.id.as('hidden', production.id)} />
			<input {...step.fields.eventId.as('hidden', eventId)} />
			<input {...step.fields.status.as('hidden', move.to)} />
			{#if (step.result as Result)?.conflict}
				{@render warningsFor(step.result as Result)}
				<input {...step.fields.acknowledged.as('hidden', true)} />
				<FormField field={step.fields.reason} type="textarea" label="Why go ahead?" required />
			{:else}
				<p class="text-muted">Move this production to <strong>{move.to}</strong>?</p>
			{/if}
		{/snippet}
	</Action>
{/each}

{#if canCancel}
	{@const cancel = advanceProduction.for('cancelled')}
	<Action
		action={cancel}
		label="Call it off"
		variant="warning"
		size="sm"
		onsuccess={(r) => done(r, 'Production cancelled')}
	>
		{#snippet form()}
			<input {...cancel.fields.id.as('hidden', production.id)} />
			<input {...cancel.fields.eventId.as('hidden', eventId)} />
			<input {...cancel.fields.status.as('hidden', 'cancelled')} />
			<p class="text-muted">
				Cancels the production record only. The listing on the guide is cancelled from the event
				page — that is what tells ticket holders.
			</p>
		{/snippet}
	</Action>
{/if}

{#if !terminal || canReopen}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="xs" shape="square" aria-label="More">
					<IconDots size={16} />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				sideOffset={4}
				align="end"
				class="z-[1000] min-w-40 rounded-lg border border-base-300 bg-base-100 p-1 shadow-lg"
			>
				{#if terminal}
					<DropdownMenu.Item class={itemClass} onSelect={() => (reopenOpen = true)}>
						Reopen…
					</DropdownMenu.Item>
				{:else}
					<DropdownMenu.Item
						class={itemClass}
						onSelect={() => {
							warned = null;
							setTo = '';
							setOpen = true;
						}}
					>
						Set status…
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	</DropdownMenu.Root>
{/if}

<Modal bind:open={setOpen} title="Set status">
	<Form
		remote={override}
		class="space-y-4"
		onsuccess={(r) => {
			const result = r as Result;
			if (result?.conflict) warned = { to: setTo, warnings: result.warnings ?? [] };
			else if (done(r, 'Status changed')) setOpen = false;
		}}
	>
		<input {...override.fields.id.as('hidden', production.id)} />
		<input {...override.fields.eventId.as('hidden', eventId)} />
		<FormField
			field={override.fields.status}
			type="select"
			label="Status"
			options={setOptions}
			bind:value={setTo}
			required
		/>
		{#if warned && warned.to === setTo}
			{@render warningsFor({ conflict: true, warnings: warned.warnings })}
			<input {...override.fields.acknowledged.as('hidden', true)} />
		{/if}
		<FormField field={override.fields.reason} type="textarea" label="Reason" required />
		<div class="flex justify-end">
			<SubmitButton label="Change status" variant="default" />
		</div>
	</Form>
</Modal>

{#if terminal && canReopen}
	<Modal bind:open={reopenOpen} title="Reopen">
		<Form
			remote={reopenProduction}
			class="space-y-4"
			onsuccess={() => {
				toast.success('Production reopened');
				reopenOpen = false;
			}}
		>
			<input {...reopenProduction.fields.id.as('hidden', production.id)} />
			<input {...reopenProduction.fields.eventId.as('hidden', eventId)} />
			<p class="text-muted text-sm">
				This show is {production.status}. Reopening it is recorded in the audit log with your
				reason.
				{#if production.status === 'cancelled'}
					Crew shifts called off with it, and the cancellation notice, are not undone.
				{/if}
			</p>
			<FormField
				field={reopenProduction.fields.status}
				type="select"
				label="Reopen to"
				options={reopenOptions}
				bind:value={reopenTo}
				required
			/>
			<FormField field={reopenProduction.fields.reason} type="textarea" label="Reason" required />
			<div class="flex justify-end">
				<SubmitButton label="Reopen" variant="default" />
			</div>
		</Form>
	</Modal>
{/if}
