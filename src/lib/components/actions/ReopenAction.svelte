<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Reopen a record in a terminal state. Rendered only for holders of the
	 * admin-only `<domain>.reopen`, and deliberately quiet: an escape hatch, not a
	 * peer of the usual actions (docs/development/conventions.md#workflow-gates).
	 * `children` says what reopening does and does not undo.
	 */
	import type { Snippet } from 'svelte';
	import type { RemoteForm } from '@sveltejs/kit';
	import Action from '../ui/Action.svelte';
	import { Field } from '../ui/Form';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { hasCapability, type Capability } from '#lib/config.js';

	let {
		action,
		id,
		capability,
		children
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		action: RemoteForm<any, any> | Omit<RemoteForm<any, any>, 'for'>;
		id: string;
		capability: Capability;
		children?: Snippet;
	} = $props();

	// The staff layout has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, capability)}
	<Action
		{action}
		label={m.actions_reopen_reopen()}
		variant="ghost"
		size="xs"
		modalTitle={m.actions_reopen_reopen()}
		submitLabel={m.actions_reopen_reopen()}
		successToast={m.actions_reopen_success_toast()}
	>
		{#snippet form()}
			<input {...action.fields.id.as('hidden', id)} />
			{#if children}
				<div class="text-muted text-sm">{@render children()}</div>
			{/if}
			<Field field={action.fields.reason} type="textarea" label={m.actions_reason()} required />
		{/snippet}
	</Action>
{/if}
