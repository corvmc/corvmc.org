<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { resendVerificationEmail } from '#lib/remote/account.remote.js';
</script>

<!-- Nothing on the site is gated on this. Confirming is what lets us
     attach a mailing list this address was already on (#757). -->
<Alert type="info">
	{m.member_account_address_not_confirmed_yet_account_body()}
	{#snippet action()}
		<Action
			action={resendVerificationEmail}
			label={m.member_account_resend_link_label()}
			size="sm"
			variant="default"
			successToast={m.member_account_success_toast()}
		/>
	{/snippet}
</Alert>
