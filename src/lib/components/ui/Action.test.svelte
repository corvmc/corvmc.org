<!--
	Test harness for Action.svelte. Two things a spec cannot supply from
	`render(Component, props)`: a `Tooltip.Provider`, without which the
	`iconOnly` trigger's `Tooltip.Root` throws (the app mounts one in
	`+layout.svelte`), and the `form` / `body` snippets, which are props.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import Action from './Action.svelte';
	import FormField from './Form/FormField.svelte';
	import type { ComponentProps } from 'svelte';

	let {
		action,
		fieldName,
		formFieldName,
		bodyText,
		...rest
	}: {
		action: ComponentProps<typeof Action>['action'];
		fieldName?: string;
		/**
		 * A real `FormField`, not the bare input `fieldName` renders: only
		 * `FormField` reports a change to the form context, which is what the
		 * unsaved-changes prompt keys on.
		 */
		formFieldName?: string;
		bodyText?: string;
		[key: string]: unknown;
	} = $props();
</script>

<Tooltip.Provider delayDuration={300}>
	{#if formFieldName}
		<Action {action} {...rest}>
			{#snippet form()}
				<FormField name={formFieldName} label="Note" type="text" />
			{/snippet}
		</Action>
	{:else if fieldName}
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
