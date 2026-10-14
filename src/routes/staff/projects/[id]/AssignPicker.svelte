<script lang="ts">
	import { Popover } from 'bits-ui';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { errorMessage } from '$lib/error-message';
	import AssignedSummary from './AssignedSummary.svelte';
	import AssignPickerBody from './AssignPickerBody.svelte';
	import type { Task } from './task-view';

	/** The Assigned value as a button that opens the picker. Its options load on open. */
	let {
		task,
		projectId,
		place,
		showNames = false
	}: { task: Task; projectId: string; place: 'row' | 'panel'; showNames?: boolean } = $props();

	let open = $state(false);
</script>

{#if task.cancelledAt || task.resolvedAt}
	<AssignedSummary {task} {showNames} />
{:else}
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="xs"
					class="depth-0 assign-trigger"
					aria-label="Change who does {task.title}"
				>
					<AssignedSummary {task} {showNames} />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Portal>
			<Popover.Content sideOffset={4} align="start" class="assign-picker">
				{#if open}
					<svelte:boundary>
						<AssignPickerBody {task} {projectId} {place} onclose={() => (open = false)} />
						{#snippet pending()}
							<span class="loading loading-sm loading-spinner" aria-label="Loading"></span>
						{/snippet}
						{#snippet failed(error, reset)}
							<Alert type="error" {reset}>Couldn't load the options: {errorMessage(error)}</Alert>
						{/snippet}
					</svelte:boundary>
				{/if}
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
{/if}

<style>
	:global(.assign-trigger) {
		height: auto;
		min-height: 1.75rem;
		justify-content: flex-start;
		font-weight: normal;
		text-align: left;
	}
	:global(.assign-picker) {
		z-index: 1000;
		width: min(22rem, calc(100vw - 2rem));
		max-height: min(32rem, var(--bits-popover-content-available-height, 80dvh));
		overflow-y: auto;
		padding: 0.75rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box);
		background: var(--color-base-100);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.2);
	}
</style>
