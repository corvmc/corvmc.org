<script lang="ts">
	import { Latest } from '#lib/latest.svelte.js';
	import { isRedirect } from '@sveltejs/kit';
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The volunteer profile: contact info, preferred roles and the hour history,
	 * under a line for each clearance that is expiring or has lapsed.
	 *
	 * "Returned", never "rejected": it is a request for a correction, not a
	 * judgement, and the stored value differs from the label on purpose.
	 */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Form, { SubmitButton } from '#lib/components/ui/Form/index.js';
	import ProfileFields from '#lib/components/volunteer/ProfileFields.svelte';
	import InterestFields from '#lib/components/volunteer/InterestFields.svelte';
	import LogHoursAction from '#lib/components/volunteer/LogHoursAction.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import {
		formatVolunteerHours,
		volunteerHourStatusLabels,
		DEFAULT_TIMEZONE
	} from '#lib/config.js';
	import {
		getMemberVolunteerProfilePage,
		saveVolunteerInterests,
		updateVolunteerProfile,
		withdrawVolunteerHours
	} from '#lib/remote/volunteer.remote.js';

	// Not a top-level await, which async-gates the forms' bindings, and not
	// `{#await}`, which re-pends on every refresh and remounts them.
	const pageData = new Latest(() => getMemberVolunteerProfilePage());
	// A gate's redirect has already navigated by the time it rejects; rethrowing
	// it would flash the error boundary on the way out.
	$effect(() => {
		if (pageData.error && !isRedirect(pageData.error.e)) throw pageData.error.e;
	});

	function toDateInput(date: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(new Date(date));
	}

	const pip: Record<string, string> = {
		approved: 'bg-success',
		pending: 'bg-warning',
		rejected: 'bg-error'
	};
</script>

<PageHeader width="3xl" title={m.member_profile_title()} subtitle={m.member_volunteering_body()} />

<PageContent width="3xl">
	{#if pageData.current}
		{@const data = pageData.current}
		{#each data.renew as c (c.name)}
			<p class="text-sm text-warning">
				{c.state === 'expired'
					? m.member_volunteer_profile_clearance_lapsed_text({ name: c.name })
					: c.expiresAt
						? m.member_volunteer_profile_clearance_expires_text({
								name: c.name,
								date: formatDateShort(c.expiresAt)
							})
						: m.member_volunteer_profile_clearance_expires_soon_text({ name: c.name })}
			</p>
		{/each}
		<InfoCard title={m.member_volunteer_profile_contact_info_title()}>
			<Form
				remote={updateVolunteerProfile}
				successToast={m.member_volunteer_profile_profile_updated_toast()}
			>
				<ProfileFields
					fields={updateVolunteerProfile.fields}
					firstName={data.access.firstName}
					lastName={data.access.lastName}
					pronouns={data.access.pronouns}
					phone={data.access.phone}
					email={data.access.email}
				/>
				<div class="flex justify-end">
					<SubmitButton
						label={m.member_save_label()}
						successLabel={m.member_saved_label()}
						variant="primary"
					/>
				</div>
			</Form>
		</InfoCard>

		<InfoCard title={m.member_preferred_roles_title()}>
			{#if data.roles.length === 0}
				<p class="text-muted">{m.member_volunteer_profile_no_volunteer_roles_open_right_text()}</p>
			{:else}
				<Form remote={saveVolunteerInterests} successToast={m.member_saved_toast()}>
					<InterestFields
						fields={saveVolunteerInterests.fields}
						roleOptions={data.roles}
						selected={data.interests}
						availability={data.access.availability}
					/>
					<div class="flex justify-end">
						<SubmitButton
							label={m.member_save_label()}
							successLabel={m.member_saved_label()}
							variant="primary"
						/>
					</div>
				</Form>
			{/if}
		</InfoCard>

		<InfoCard title={m.member_volunteer_profile_volunteer_hours_title()}>
			{#snippet action()}
				<LogHoursAction
					roles={data.roles}
					programs={data.programs}
					label={m.member_volunteer_profile_log_hours_label()}
					variant="primary"
					size="sm"
				/>
			{/snippet}
			{#if data.logs.length === 0}
				<EmptyState title={m.member_volunteer_profile_nothing_filed_yet_title()} />
			{:else}
				<ul class="flex flex-col gap-3">
					{#each data.logs as log (log.id)}
						<li
							class="rounded-lg border border-base-300 p-3"
							class:bg-error-content={log.status === 'rejected'}
						>
							<div class="flex flex-wrap items-center gap-2">
								<span class="size-2 rounded-full {pip[log.status]}"></span>
								<span class="font-medium">{log.roleName}</span>
								<Badge
									variant={log.status === 'approved'
										? 'success'
										: log.status === 'rejected'
											? 'error'
											: 'warning'}
									size="sm"
								>
									{volunteerHourStatusLabels[log.status]}
								</Badge>
								<span class="ml-auto text-subtle text-sm">
									{formatVolunteerHours(log.minutes)} · {formatDateShort(log.workedOn)}
								</span>
							</div>

							<p class="mt-1 text-sm">{log.description}</p>

							{#if log.status === 'rejected' && log.reviewNotes}
								<!-- In full, never truncated: it is the instruction for what to
								     change, and a clipped one sends them back to guess. -->
								<p class="mt-2 text-sm text-error">{log.reviewNotes}</p>
							{/if}

							{#if log.memberEditable}
								<div class="mt-2 flex flex-wrap gap-2">
									<LogHoursAction
										mode="fix"
										size="xs"
										label={log.status === 'rejected'
											? m.member_volunteer_profile_fix_label()
											: m.member_edit_label()}
										log={{
											id: log.id,
											volunteerRoleId: log.volunteerRoleId,
											workedOn: toDateInput(log.workedOn),
											hours: String(log.minutes / 60),
											description: log.description
										}}
									/>
									<Action
										action={withdrawVolunteerHours.for(log.id)}
										label={m.member_withdraw_label()}
										data-testid="withdraw-hours"
										variant="ghost"
										size="xs"
										class="text-error"
										modalTitle={m.member_volunteer_profile_modal_title()}
										submitLabel={m.member_withdraw_label()}
										submitVariant="error"
										successToast={m.member_volunteer_profile_withdrawn_toast()}
									>
										{#snippet form()}
											<input
												{...withdrawVolunteerHours.for(log.id).fields.id.as('hidden', log.id)}
											/>
											<p class="text-sm">
												{m.member_volunteer_profile_comes_off_record_file_again_text()}
											</p>
										{/snippet}
									</Action>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/if}
</PageContent>
