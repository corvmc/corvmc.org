<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Which outside party this conversation is filed to (#2622), so it shows on
	 * that organization's or person's timeline. A sender whose address is on
	 * file is offered in one click; any organization can be picked.
	 */
	import { resolve } from '$app/paths';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { fileThreadForm, getThreadFiling } from '#lib/remote/inbox.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { Latest } from '#lib/latest.svelte.js';

	let { threadId }: { threadId: string } = $props();

	const suggest = $derived(fileThreadForm.for(`suggest-${threadId}`));
	const pick = $derived(fileThreadForm.for(`pick-${threadId}`));
	const unfile = $derived(fileThreadForm.for(`unfile-${threadId}`));
	// Latest, not `{#await}`: a refresh after filing must not rebuild the forms.
	const latest = new Latest(() => getThreadFiling(threadId));
</script>

{#if latest.error}
	<span class="text-subtle">{m.ui_load_failed_text({ error: errorMessage(latest.error.e) })}</span>
{:else if latest.current === undefined}
	<span class="loading loading-xs loading-spinner"></span>
{:else if latest.current}
	{@const filing = latest.current}
	<div class="flex flex-col gap-1" data-testid="thread-filing">
		<SectionLabel label={m.staff_inbox_filed_to_label()} />
		{#if filing.filed}
			<a
				class="link link-primary"
				href={filing.filed.type === 'organization'
					? resolve('/staff/contacts/[id]', { id: filing.filed.id })
					: resolve('/staff/contacts/people/[id]', { id: filing.filed.id })}>{filing.filed.name}</a
			>
		{:else}
			<span class="text-subtle">{m.staff_inbox_not_filed_text()}</span>
		{/if}
		{#if filing.canFile}
			<div class="flex flex-wrap gap-1">
				{#if filing.suggestion}
					<Form remote={suggest} successToast={m.staff_inbox_filed_toast()}>
						<input {...suggest.fields.threadId.as('hidden', threadId)} />
						<input {...suggest.fields.contactId.as('hidden', filing.suggestion.id)} />
						<SubmitButton
							label={m.staff_inbox_file_to_label({ name: filing.suggestion.name })}
							variant="ghost"
							size="xs"
						/>
					</Form>
				{/if}
				{#if filing.organizations.length > 0}
					<Action
						action={pick}
						label={m.staff_inbox_file_label()}
						modalTitle={m.staff_inbox_file_title()}
						successToast={m.staff_inbox_filed_toast()}
						variant="ghost"
						size="xs"
						data-testid="file-thread"
					>
						{#snippet form()}
							<input {...pick.fields.threadId.as('hidden', threadId)} />
							<Field
								field={pick.fields.organizationId}
								type="select"
								label={m.staff_contacts_organization_label()}
								options={filing.organizations.map((o) => ({ value: o.id, label: o.name }))}
							/>
						{/snippet}
					</Action>
				{/if}
				{#if filing.filed}
					<Form remote={unfile} successToast={m.staff_inbox_unfiled_toast()}>
						<input {...unfile.fields.threadId.as('hidden', threadId)} />
						<SubmitButton label={m.staff_inbox_unfile_label()} variant="ghost" size="xs" />
					</Form>
				{/if}
			</div>
		{/if}
	</div>
{/if}
