<!--
	Test harness for Action.svelte. Two things a spec cannot supply from
	`render(Component, props)`: a `Tooltip.Provider`, without which the
	`iconOnly` trigger's `Tooltip.Root` throws (the app mounts one in
	`+layout.svelte`), and the `form` / `body` snippets, which are props.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import Action from './Action.svelte';
	import type { ComponentProps } from 'svelte';

	let {
		action,
		fieldName,
		bodyText,
		...rest
	}: {
		action: ComponentProps<typeof Action>['action'];
		fieldName?: string;
		bodyText?: string;
		[key: string]: unknown;
	} = $props();
</script>

<Tooltip.Provider delayDuration={300}>
	{#if fieldName}
		<Action {action} {...rest}>
			{#snippet form()}
				<input name={fieldName} class="input" />
			{/snippet}
		</Action>
	{:else if bodyText}
		<Action {action} {...rest}>
			{#snippet body({ run, status })}
				<p>{bodyText}</p>
				<p data-testid="status">{status}</p>
				<button type="button" onclick={run}>Go</button>
			{/snippet}
		</Action>
	{:else}
		<Action {action} {...rest} />
	{/if}
</Tooltip.Provider>
