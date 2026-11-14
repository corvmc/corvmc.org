<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { canImpersonate, startImpersonation } from '#lib/remote/impersonation.remote.js';
	import { Latest } from '#lib/latest.svelte.js';

	/** Admins only, and never on another admin (#2847). The server checks both again. */
	let { id }: { id: string } = $props();
	const fields = startImpersonation.fields;
	const allowed = new Latest(() => canImpersonate(id));
</script>

{#if allowed.current}
	<Form remote={startImpersonation} class="mb-4" data-testid="view-as-member">
		<input {...fields.userId.as('hidden', id)} />
		<SubmitButton label={m.staff_member_view_as_member_label()} variant="ghost" size="sm" />
	</Form>
{/if}
