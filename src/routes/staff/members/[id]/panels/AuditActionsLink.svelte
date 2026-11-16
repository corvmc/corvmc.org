<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import { hasCapability } from '#lib/config.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { withQuery } from '#lib/utils/with-query.js';

	/** The audit log filtered to entries this member made, for holders of `audit.read`. */
	let { userId }: { userId: string } = $props();

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, 'audit.read')}
	<Button
		variant="ghost"
		size="sm"
		href={withQuery(resolve('staff/system/audit'), new URLSearchParams({ actor: userId }))}
	>
		{m.staff_audit_member_actions_label()}
	</Button>
{/if}
