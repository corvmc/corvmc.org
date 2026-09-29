<script lang="ts">
	import { formatDate } from '$lib/utils/format';

	/** The invite-back record from this vendor's last market, matched by email (#1505). */
	let {
		previous
	}: {
		previous: {
			eventTitle: string;
			startsAt: Date;
			status: string;
			inviteBack: boolean;
			note: string | null;
		} | null;
	} = $props();
</script>

{#if previous}
	<div
		class="text-sm"
		class:text-success={previous.inviteBack}
		class:text-error={!previous.inviteBack}
	>
		{previous.inviteBack ? 'Invite back' : 'Do not invite back'}
		<span class="text-muted">
			· {previous.eventTitle}, {formatDate(previous.startsAt)}{previous.status === 'no_show'
				? ', no-show'
				: ''}{previous.note ? `: “${previous.note}”` : ''}
		</span>
	</div>
{/if}
