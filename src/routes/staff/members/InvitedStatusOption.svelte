<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	// Presentation only: the invite list's remote guards on `user.invite` itself.
	// The staff layout already fetched this; the call dedupes to it.
	const canInvite = $derived(hasCapability((await getStaffLayout()).capabilities, 'user.invite'));
</script>

{#if canInvite}
	<option value="invited">{m.staff_members_invites_invited_label()}</option>
{/if}
