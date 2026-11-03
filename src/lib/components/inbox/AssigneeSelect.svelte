<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { Latest } from '$lib/latest.svelte';

	/**
	 * The note composer's hand-over select, with its own data. Its own component
	 * so the staff list loads only once a note is being written, and through
	 * `Latest` so a refresh keeps the select mounted (#2357).
	 */
	let {
		assignees,
		value = $bindable('')
	}: {
		assignees: () => Promise<{ id: string; name: string }[]>;
		value?: string;
	} = $props();

	const staff = new Latest(() => assignees());
	$effect(() => {
		if (staff.error) throw staff.error.e;
	});
</script>

{#if staff.current}
	<label class="flex items-center gap-2 text-sm">
		<span class="text-subtle">{m.inbox_thread_composer_assign()}</span>
		<Select
			size="sm"
			{value}
			aria-label={m.inbox_thread_composer_assign()}
			onchange={(e: Event) => (value = (e.currentTarget as HTMLSelectElement).value)}
		>
			<option value="">{m.inbox_thread_composer_nobody()}</option>
			{#each staff.current as s (s.id)}
				<option value={s.id}>{s.name}</option>
			{/each}
		</Select>
	</label>
{/if}
