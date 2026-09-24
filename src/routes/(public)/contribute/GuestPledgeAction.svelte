<script lang="ts">
	import { Turnstile } from 'svelte-turnstile';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { pledgeWishlistAsGuest } from '$lib/remote/inventory.remote';
	import { TURNSTILE_SITE_KEY, TURNSTILE_RESPONSE_FIELD } from '$lib/turnstile';
	import type { WishlistPledgeSubject } from '$lib/config';

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
	label="I'll bring this"
	aria-label={`Pledge to bring ${entryName}`}
	modalTitle="Bring {entryName}"
	submitLabel="Email me a link"
	successToast="Check your email to confirm"
	variant="default"
	outline
	size="xs"
	onfailure={() => resetTurnstile?.()}
>
	{#snippet form()}
		<input {...action.fields.subjectType.as('hidden', subjectType)} />
		<input {...action.fields.subjectId.as('hidden', subjectId)} />
		<p class="text-muted text-sm">
			Staff will expect it for 30 days once you confirm from the email. Your name is never shown on
			the site.
		</p>
		<Field field={action.fields.name} type="text" label="Your name" />
		<Field field={action.fields.email} type="email" label="Your email" />
		<Turnstile
			siteKey={TURNSTILE_SITE_KEY}
			responseFieldName={TURNSTILE_RESPONSE_FIELD}
			theme="auto"
			bind:reset={resetTurnstile}
		/>
	{/snippet}
</Action>
