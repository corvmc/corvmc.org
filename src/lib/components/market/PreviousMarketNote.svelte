<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
		{previous.inviteBack ? m.market_invite_back() : m.market_do_not_invite_back()}
		<span class="text-muted">
			· {previous.eventTitle}, {formatDate(previous.startsAt)}{previous.status === 'no_show'
				? m.market_previous_market_note_no_show()
				: ''}{previous.note ? `: “${previous.note}”` : ''}
		</span>
	</div>
{/if}
