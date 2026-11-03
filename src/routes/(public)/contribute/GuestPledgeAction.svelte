<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { Turnstile } from 'svelte-turnstile';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { pledgeWishlistAsGuest } from '#lib/remote/inventory.remote.js';
	import { TURNSTILE_SITE_KEY, TURNSTILE_RESPONSE_FIELD } from '#lib/turnstile.js';
	import type { WishlistPledgeSubject } from '#lib/config.js';

	/**
	 * A non-member's pledge (#1565). Nothing is held until the email link is
	 * confirmed, so the toast says to check their inbox rather than "thanks".
	 */
	let {
		subjectType,
		subjectId,
		entryName
	}: { subjectType: WishlistPledgeSubject; subjectId: string; entryName: string } = $props();

	const action = $derived(pledgeWishlistAsGuest.for(`${subjectType}:${subjectId}`));
	let resetTurnstile = $state<() => void>();
</script>

<Action
	{action}
	label={m.public_i_ll_bring()}
	aria-label={m.public_contribute_guest_pledge_aria_label({ entryName })}
	modalTitle={m.public_contribute_guest_pledge_modal_title({ entryName })}
	submitLabel={m.public_contribute_guest_pledge_submit_label()}
	successToast={m.public_contribute_guest_pledge_success_toast()}
	variant="default"
	outline
	size="xs"
	onfailure={() => resetTurnstile?.()}
>
	{#snippet form()}
		<input {...action.fields.subjectType.as('hidden', subjectType)} />
		<input {...action.fields.subjectId.as('hidden', subjectId)} />
		<p class="text-muted text-sm">
			{m.public_contribute_guest_pledge_staff_will_expect_30_days()}
		</p>
		<Field field={action.fields.name} type="text" label={m.public_name_2()} />
		<Field field={action.fields.email} type="email" label={m.public_email_2()} />
		<Turnstile
			siteKey={TURNSTILE_SITE_KEY}
			responseFieldName={TURNSTILE_RESPONSE_FIELD}
			theme="auto"
			bind:reset={resetTurnstile}
		/>
	{/snippet}
</Action>
