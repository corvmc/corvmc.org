<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { RemoteForm } from '@sveltejs/kit';
	import { toast } from 'svelte-sonner';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import type { ButtonShape, ButtonSize, ButtonVariant } from './Button.svelte';
	import Form from './Form/Form.svelte';
	import SubmitButton from './Form/SubmitButton.svelte';
	import { IconCheck, IconX } from '@tabler/icons-svelte';

	// ---------------------------------------------------------------------------
	// Props
	// ---------------------------------------------------------------------------

	type Status = 'idle' | 'pending' | 'success' | 'error';

	interface TriggerProps {
		onclick: () => void;
		disabled: boolean;
		status: Status;
	}

	let {
		action,
		label = 'Run',
		icon,
		iconOnly = false,
		successLabel = 'Done',
		errorLabel = 'Error',
		confirm,
		modalTitle,
		form: formSnippet,
		body,
		trigger,
		submitLabel,
		submitVariant,
		noFooter = false,
		successToast,
		maxWidth = 'max-w-lg',
		flashDuration = 1500,
		variant = 'primary',
		size = 'md',
		shape,
		outline = false,
		class: className = '',
		disabled = false,
		onsuccess,
		onfailure,
		...rest
	}: {
		/**
		 * A remote form, one of its `.for(id)` instances (which drops `for` from
		 * the type), or a plain async callback.
		 */
		action: (() => Promise<unknown>) | RemoteForm<any, any> | Omit<RemoteForm<any, any>, 'for'>;
		label?: string;
		icon?: Snippet;
		/**
		 * Render the trigger as icon-only, with `label` moved to a tooltip. Use in
		 * table action cells — pairing `btn-square` with a visible label overflows
		 * the square.
		 */
		iconOnly?: boolean;
		successLabel?: string;
		errorLabel?: string;
		confirm?: string;
		modalTitle?: string;
		form?: Snippet<[{ close: () => void }]>;
		body?: Snippet<[{ close: () => void; run: () => void; status: Status }]>;
		trigger?: Snippet<[TriggerProps]>;
		submitLabel?: string;
		/** Colour of the modal's submit button; defaults to the trigger's `variant`. */
		submitVariant?: ButtonVariant;
		noFooter?: boolean;
		maxWidth?: string;
		successToast?: string;
		flashDuration?: number;
		variant?: ButtonVariant;
		size?: ButtonSize;
		shape?: ButtonShape;
		outline?: boolean;
		class?: string;
		disabled?: boolean;
		onsuccess?: (result?: unknown) => void;
		onfailure?: (error?: unknown) => void;
		[key: string]: unknown;
	} = $props();

	// ---------------------------------------------------------------------------
	// Mode detection
	// ---------------------------------------------------------------------------

	const isForm = $derived(typeof action !== 'function');
	const hasModal = $derived(isForm || !!body || !!confirm);

	// ---------------------------------------------------------------------------
	// Shared state
	// ---------------------------------------------------------------------------

	let status = $state<Status>('idle');
	let dialogOpen = $state(false);

	function close() {
		dialogOpen = false;
	}

	// ---------------------------------------------------------------------------
	// Direct / confirm / callback+form / callback+body action mode
	// ---------------------------------------------------------------------------

	async function run() {
		if (status === 'pending' || isForm) return;

		status = 'pending';
		const minDelay = new Promise((r) => setTimeout(r, 150));

		try {
			const result = await (action as () => Promise<unknown>)();
			await minDelay;
			dialogOpen = false;
			onsuccess?.(result);
			toast.success(successToast ?? `${label} successful`);
			status = 'success';
		} catch (err) {
			await minDelay;
			onfailure?.(err);
			status = 'error';
			console.error('[Action] action failed:', err);
			throw err;
		} finally {
			setTimeout(() => {
				status = 'idle';
			}, flashDuration);
		}
	}

	function handleClick() {
		if (hasModal) dialogOpen = true;
		else run();
	}

	function handleFormSuccess(result?: unknown) {
		// A wizard can signal a recoverable, in-place outcome (e.g. a booking slot
		// taken between selection and submit, or an out-of-window date) that must
		// keep the modal open so the user can adjust and retry. The form's own
		// components handle the recovery.
		if (result && typeof result === 'object') {
			const r = result as { conflict?: boolean; validationError?: string };
			if (r.conflict || r.validationError) return;
		}
		dialogOpen = false;
		if (typeof onsuccess === 'function') onsuccess(result);
	}

	function handleFormFailure(issues?: unknown) {
		if (typeof onfailure === 'function') onfailure(issues);
	}
</script>

<!-- Trigger -->
{#if trigger}
	{@render trigger({ onclick: handleClick, disabled: disabled || status === 'pending', status })}
{:else}
	<Button
		title={iconOnly ? label : undefined}
		aria-label={iconOnly ? label : undefined}
		disabled={disabled || status === 'pending'}
		onclick={handleClick}
		{variant}
		{size}
		{shape}
		{outline}
		class={className}
		{...rest}
	>
		{#if status === 'success'}
			<IconCheck size={16} />
			{#if !iconOnly}{successLabel}{/if}
		{:else if status === 'error'}
			<IconX size={16} />
			{#if !iconOnly}{errorLabel}{/if}
		{:else if status === 'pending'}
			<span class="loading loading-spinner"></span>
			{#if !iconOnly}{label}{/if}
		{:else}
			{@render icon?.()}
			{#if !iconOnly}{label}{/if}
		{/if}
	</Button>
{/if}

{#if hasModal}
	<Modal bind:open={dialogOpen} title={modalTitle} {maxWidth}>
		{#if body}
			{@render body({ close, run, status })}
		{:else if isForm}
			<!-- RemoteForm actions always submit through <Form> so `run()` (callback-only)
			     is never involved. `confirm`, when set, renders as a lead-in above the fields. -->
			<Form
				class="space-y-4"
				remote={action as RemoteForm<any, any>}
				{successToast}
				onsuccess={handleFormSuccess}
				onfailure={handleFormFailure}
			>
				{#if confirm}
					<p class="py-4">{confirm}</p>
				{/if}
				{@render formSnippet?.({ close })}
				{#if !noFooter}
					<div class="flex justify-end pt-2">
						<SubmitButton label={submitLabel ?? label} variant={submitVariant ?? variant} />
					</div>
				{/if}
			</Form>
		{:else if confirm}
			<p class="py-4">{confirm}</p>
			<div class="modal-action">
				<Button type="button" variant="default" outline onclick={close}>Dismiss</Button>
				<Button type="button" variant="primary" onclick={run}>
					{@render icon?.()}
					{label}
				</Button>
			</div>
		{/if}
	</Modal>
{/if}
