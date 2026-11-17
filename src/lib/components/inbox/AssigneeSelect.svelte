<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { RemoteQuery } from '$app/server';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { Latest } from '#lib/latest.svelte.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';

	/**
	 * The note composer's hand-over select, with its own data. Its own component
	 * so the staff list loads only once a note is being written, and through
	 * `Latest` so a refresh keeps the select mounted (#2357).
	 */
	let {
		assignees,
		value = $bindable('')
	}: {
		assignees: () => RemoteQuery<{ id: string; name: string }[]>;
		value?: string;
	} = $props();

	const staff = new Latest(() => assignees());
	const staffList = $derived(staff.current ?? (await assignees().catch(() => undefined)));
</script>

{#if staffList}
	<label class="flex items-center gap-2 text-sm">
		<span class="text-subtle">{m.inbox_thread_composer_assign_label()}</span>
		<Select
			size="sm"
			{value}
			aria-label={m.inbox_thread_composer_assign_label()}
			onchange={(e: Event) => (value = (e.currentTarget as HTMLSelectElement).value)}
		>
			<option value="">{m.inbox_thread_composer_nobody_label()}</option>
			{#each staffList as s (s.id)}
				<option value={s.id}>{s.name}</option>
			{/each}
		</Select>
	</label>
{:else if staff.error}
	<Alert type="warning" reset={() => void assignees().refresh()}>
		{m.ui_load_failed_body({ error: errorMessage(staff.error.e) })}
	</Alert>
{/if}
