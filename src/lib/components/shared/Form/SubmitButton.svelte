<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { IconCheck, IconX } from '@tabler/icons-svelte';
	import { getFormContext } from './Form.svelte';
	import { useShortcut, shortcutLabel } from '$lib/useShortcut.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import type { ButtonSize, ButtonVariant } from '$lib/components/shared/Button.svelte';

	let {
		shortcut,
		icon,
		label = 'Save',
		continueLabel = 'Continue',
		successLabel = 'Saved',
		errorLabel = 'Error',
		variant = 'primary',
		size = 'md',
		class: className = '',
		disabled = false,
		...rest
	}: {
		shortcut?: string;
		icon?: Snippet;
		label?: string;
		continueLabel?: string;
		successLabel?: string;
		errorLabel?: string;
		/** Idle colour. The success/error flash overrides it while it lasts. */
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		disabled?: boolean;
		[key: string]: unknown;
	} = $props();

	let ctx = getFormContext()!;

	const isLastStep = $derived(ctx.currentStep >= ctx.totalSteps - 1);
	const activeLabel = $derived(isLastStep ? label : continueLabel);
	// `!browser` renders the button disabled in the SSR HTML and enables it on
	// hydration. Every form here submits through JS (a remote form or an `action`
	// callback), so a click that lands before the handlers attach does a native
	// submit that goes nowhere — invisible until the public pages started
	// server-rendering their forms instead of a spinner, which opened a real
	// window between paint and hydrate. Enter-in-a-field bypasses the button, so
	// Form.svelte's `method="post"` still matters as the second line of defence.
	const isDisabled = $derived(
		!browser ||
			disabled ||
			!ctx.currentStepValid ||
			(ctx.status !== 'idle' && ctx.status !== 'dirty')
	);

	// The status flash outranks the caller's colour: a destructive `variant="error"`
	// submit that has just succeeded should read as success, not stay red.
	const activeVariant = $derived(
		ctx.status === 'success' ? 'success' : ctx.status === 'error' ? 'error' : variant
	);

	let keys = useShortcut(
		() => shortcut,
		() => {
			if (ctx.status !== 'pending' && !disabled) {
				if (isLastStep) ctx.submit();
				else ctx.next();
			}
		}
	);
</script>

<div class="flex items-center gap-2">
	{#if ctx.currentStep > 0}
		<Button type="button" variant="ghost" onclick={() => ctx.back()}>Back</Button>
	{/if}
	<Button
		type={isLastStep ? 'submit' : 'button'}
		variant={activeVariant}
		{size}
		class={className}
		disabled={isDisabled}
		onclick={isLastStep ? undefined : () => ctx.next()}
		{...rest}
	>
		{#if ctx.status === 'pending'}
			<span class="loading loading-spinner loading-sm"></span>
			{activeLabel}
		{:else if ctx.status === 'success'}
			<IconCheck size={20} />
			{successLabel}
		{:else if ctx.status === 'error'}
			<IconX size={20} />
			{errorLabel}
		{:else}
			{#if keys.modHeld && keys.parsed}
				<kbd class="kbd kbd-sm text-base-content">{shortcutLabel(keys.parsed)}</kbd>
			{:else if icon}
				{@render icon()}
			{/if}
			{activeLabel}
		{/if}
	</Button>
</div>
