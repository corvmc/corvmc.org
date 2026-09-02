<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	/**
	 * The "about you" half of volunteer onboarding, shared by the start step and
	 * the Profile modal on /member/volunteer. The step adds the 18-or-older
	 * select after it; the modal deliberately does not, because re-submitting
	 * that answer is how a blocked minor would unblock themselves.
	 *
	 * First and last name are stored on `volunteer_profile`. Pronouns and phone
	 * are written straight back to `user`, where they already live and where
	 * /member/account edits them — a second copy would be stale within a week.
	 *
	 * Takes plain props, never a query: a top-level `await` in a component that
	 * also renders a form marks the later declarations async-gated, and every
	 * `bind:value` then blows up with effect_update_depth_exceeded.
	 */
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { resolve } from '$app/paths';

	let {
		fields,
		firstName = '',
		lastName = '',
		pronouns = '',
		phone = '',
		email
	}: {
		/** `remote.fields` from the form this is rendered inside. */
		/** The subset of `remote.fields` this set posts into. */
		fields: {
			firstName: RemoteFormField<string>;
			lastName: RemoteFormField<string>;
			pronouns: RemoteFormField<string>;
			phone: RemoteFormField<string>;
		};
		firstName?: string;
		lastName?: string;
		pronouns?: string;
		phone?: string;
		email: string;
	} = $props();
</script>

<div class="grid grid-cols-2 gap-4">
	<FormField field={fields.firstName} type="text" label="First name" value={firstName} required />
	<FormField field={fields.lastName} type="text" label="Last name" value={lastName} required />
</div>

<FormField
	field={fields.pronouns}
	type="text"
	label="Pronouns"
	value={pronouns}
	placeholder="e.g. they/them"
/>

<FormField
	field={fields.phone}
	type="tel"
	label="Phone"
	value={phone}
	placeholder="(541) 555-0123"
	description="For shift-day contact."
/>

<!--
	Read-only, unlike phone and pronouns above: this is the address they log in
	with, and changing it runs through its own verification flow. Shown so they
	can check we have the right one.
-->
<FormField type="email" label="Email" value={email} readonly description={emailHint} />

{#snippet emailHint()}
	Change this in your
	<a href={resolve('/member/account')} class="link link-primary">account settings</a>.
{/snippet}
