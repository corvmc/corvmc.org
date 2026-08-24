<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '$lib/components/shared/Button.svelte';

	type AlertType = 'info' | 'warning' | 'error' | 'success';

	const typeClass: Record<AlertType, string> = {
		info: 'alert-info',
		warning: 'alert-warning',
		error: 'alert-error',
		success: 'alert-success'
	};

	let {
		type = 'info',
		href,
		reset,
		children,
		action,
		class: className = ''
	}: {
		type?: AlertType;
		href?: string;
		reset?: () => void;
		children: Snippet;
		action?: Snippet;
		class?: string;
	} = $props();
</script>

{#if href}
	<a {href} class="alert {typeClass[type]} {className}">
		<span>{@render children()}</span>
	</a>
{:else}
	<div class="alert {typeClass[type]} {className}" role="alert">
		<div>{@render children()}</div>
		{#if reset}
			<Button variant="default" size="sm" onclick={reset}>Retry</Button>
		{:else if action}
			{@render action()}
		{/if}
	</div>
{/if}
