<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { getImpersonation, stopImpersonation } from '#lib/remote/impersonation.remote.js';
	import { Latest } from '#lib/latest.svelte.js';

	/**
	 * On every page while an admin views the app as a member (#2847). Renders
	 * nothing otherwise, and nothing if the read fails: the session is the
	 * member's either way, and the next page load tries again.
	 */
	const viewing = new Latest(() => getImpersonation());
</script>

{#if viewing.current}
	<div
		class="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-warning px-4 py-2 text-sm text-warning-content"
		role="status"
		data-testid="impersonation-banner"
	>
		<span>{m.layout_impersonation_viewing_as_text({ name: viewing.current.memberName })}</span>
		<Form remote={stopImpersonation}>
			<SubmitButton label={m.layout_impersonation_stop_label()} size="xs" />
		</Form>
	</div>
{/if}
