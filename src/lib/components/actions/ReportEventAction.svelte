<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { IconFlag } from '@tabler/icons-svelte';
	import { Turnstile } from 'svelte-turnstile';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { submitEventReport } from '#lib/remote/flags.remote.js';
	import { TURNSTILE_SITE_KEY, turnstileFailureMessage } from '#lib/turnstile.js';
	import Alert from '../ui/Alert.svelte';
	import type { RemoteFormIssue } from '$app/server';

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
	label={m.actions_report()}
	modalTitle={eventTitle
		? m.actions_report_event_report({ eventTitle })
		: m.actions_report_event_report_listing()}
	submitLabel={m.actions_submit_report()}
	successToast={m.actions_report_submitted_thank()}
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
				{m.actions_report_event_let_staff_know_what_s()}
			</p>
			<!-- Custom inputs rather than FormField's own: both keep `bind:value`,
			     which `canSubmit` and the post-success reset read, and the textarea
			     keeps its rows and length cap. The wrapper is here for the error
			     slot — a rejected report whose message never renders reads as a
			     submit that did nothing. -->
			<FormField field={fields.reason} label={m.actions_reason()}>
				{#snippet input(id)}
					<input
						{...fields.reason.as('text')}
						{id}
						class="input w-full"
						bind:value={reason}
						maxlength="100"
						placeholder={m.actions_report_event_e_g_inappropriate_content_misleading()}
					/>
				{/snippet}
			</FormField>
			<FormField field={fields.description} label={m.actions_details_optional()}>
				{#snippet input(id)}
					<textarea
						{...fields.description.as('text')}
						{id}
						class="textarea w-full"
						rows="3"
						maxlength="1000"
						bind:value={description}
						placeholder={m.actions_anything_else_would_help_us()}></textarea>
				{/snippet}
			</FormField>
			<Turnstile
				siteKey={TURNSTILE_SITE_KEY}
				responseFieldName={fields.turnstileToken.as('hidden', '').name}
				theme="auto"
				bind:reset={resetTurnstile}
			/>
			{#if failure}
				<Alert type="error">{failure}</Alert>
			{/if}
		</div>
	{/snippet}
</Action>
