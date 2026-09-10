<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { IconFlag } from '@tabler/icons-svelte';
	import { Turnstile } from 'svelte-turnstile';
	import { submitEventReport } from '$lib/remote/flags.remote';
	import {
		TURNSTILE_SITE_KEY,
		TURNSTILE_RESPONSE_FIELD,
		turnstileFailureMessage
	} from '$lib/turnstile';
	import Alert from '../ui/Alert.svelte';
	import type { RemoteFormIssue } from '@sveltejs/kit';

	let {
		eventId,
		eventTitle,
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		...rest
	}: {
		eventId: string;
		eventTitle?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		[key: string]: unknown;
	} = $props();

	const { fields } = submitEventReport;

	let reason = $state('');
	let description = $state('');
	let resetTurnstile = $state<() => void>();
	let failure = $state<string | null>(null);
</script>

<Action
	action={submitEventReport}
	label="Report"
	modalTitle={eventTitle ? `Report ${eventTitle}` : 'Report this listing'}
	submitLabel="Submit report"
	successToast="Report submitted — thank you"
	{variant}
	{size}
	class={className}
	canSubmit={reason.trim().length > 0}
	onsuccess={() => {
		reason = '';
		description = '';
		failure = null;
	}}
	onfailure={(issues) => {
		resetTurnstile?.();
		// The widget owns its own hidden input, so `turnstileToken` has no
		// FormField to render its issue in — and passing `onfailure` at all
		// suppresses Form's fallback toast. Without this the dialog stays open,
		// the widget resets, and the reporter is told nothing.
		failure = turnstileFailureMessage((issues as RemoteFormIssue[] | null) ?? null);
	}}
	{...rest}
>
	{#snippet icon()}<IconFlag size={16} />{/snippet}
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="space-y-3">
			<p class="text-muted">
				Let staff know what's wrong with this listing. Reports are private and reviewed by the CMC
				team.
			</p>
			<label class="fieldset w-full">
				<span class="fieldset-legend">Reason</span>
				<input
					{...fields.reason.as('text')}
					class="input w-full"
					bind:value={reason}
					maxlength="100"
					placeholder="e.g. Inappropriate content, misleading info, spam"
				/>
			</label>
			<label class="fieldset w-full">
				<span class="fieldset-legend">Details (optional)</span>
				<textarea
					{...fields.description.as('text')}
					class="textarea w-full"
					rows="3"
					maxlength="1000"
					bind:value={description}
					placeholder="Anything else that would help us review this"></textarea>
			</label>
			<Turnstile
				siteKey={TURNSTILE_SITE_KEY}
				responseFieldName={TURNSTILE_RESPONSE_FIELD}
				theme="auto"
				bind:reset={resetTurnstile}
			/>
			{#if failure}
				<Alert type="error">{failure}</Alert>
			{/if}
		</div>
	{/snippet}
</Action>
