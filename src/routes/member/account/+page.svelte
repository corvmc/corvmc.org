<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import DirectMessagesSection from './DirectMessagesSection.svelte';
	import EmailSubscriptionsSection from './EmailSubscriptionsSection.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import { getMyMessagingSettings } from '#lib/remote/direct-messages.remote.js';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Action from '#lib/components/ui/Action.svelte';
	import { IconMail, IconBell } from '@tabler/icons-svelte';
	import {
		updateProfile,
		changePassword,
		deleteAccount,
		resendVerificationEmail
	} from '#lib/remote/account.remote.js';
	import { ADULT_AGE_YEARS, toBirthDateInput } from '#lib/utils/age.js';
	import {
		getMemberAccountPage,
		setNotificationPreference
	} from '#lib/remote/notifications.remote.js';

	const pageData = $derived(await getMemberAccountPage());
	const data = $derived(pageData.account);
	const notifPrefs = $derived(pageData.notificationPreferences);

	const { fields } = updateProfile;
</script>

<PageHeader width="2xl" title={m.member_account_account_settings()} />
<PageContent width="2xl">
	<!-- Profile info -->
	<InfoCard title={m.member_account_contact_information()}>
		<Form
			remote={updateProfile}
			guard
			onsuccess={() => toast.success(m.member_account_contact_info_updated())}
		>
			<div class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<FormField
						field={fields.name}
						type="text"
						label={m.member_name()}
						value={data.user.name}
						required
					/>
					<FormField
						field={fields.pronouns}
						type="text"
						label={m.member_pronouns()}
						value={data.user.pronouns ?? ''}
						placeholder={m.member_account_placeholder()}
					/>
				</div>

				<FormField
					type="email"
					label={m.member_email()}
					value={data.user.email}
					readonly
					description={m.member_account_contact_staff_change_email_address()}
				/>

				<!-- Nothing on the site is gated on this. Confirming is what lets us
				     attach a mailing list this address was already on (#757). -->
				{#if !data.user.emailVerified}
					<Alert type="info">
						{m.member_account_address_not_confirmed_yet_account()}
						{#snippet action()}
							<Action
								action={resendVerificationEmail}
								label={m.member_account_resend_link()}
								size="sm"
								variant="default"
								successToast={m.member_account_success_toast()}
							/>
						{/snippet}
					</Alert>
				{/if}

				<FormField
					field={fields.phone}
					type="tel"
					label={m.member_phone()}
					value={data.user.phone ?? ''}
					placeholder="(541) 555-0123"
				/>

				<!-- Answerable once, then read-only. Messaging eligibility is derived
				     from it, so a member who could re-answer could lift their own
				     restriction — the same reason the volunteer onboarding form omits
				     `isAdult` from its edit schema. Staff can correct a mistake. -->
				{#if data.user.dateOfBirth}
					<FormField
						type="date"
						label={m.member_account_date_birth()}
						value={toBirthDateInput(data.user.dateOfBirth)}
						readonly
						description={m.member_account_contact_staff_if_wrong()}
					/>
				{:else}
					<FormField
						field={fields.dateOfBirth}
						type="date"
						label={m.member_account_date_birth()}
						value=""
						description={m.member_account_optional_few_things_direct_messages({ ADULT_AGE_YEARS })}
					/>
				{/if}

				<div class="flex justify-end pt-2">
					<SubmitButton
						label={m.member_save()}
						successLabel={m.member_saved()}
						variant="primary"
						shortcut="mod+s"
					/>
				</div>
			</div>
		</Form>
	</InfoCard>

	<!-- Notification preferences -->
	<InfoCard title={m.member_account_notification_preferences()}>
		{#if notifPrefs.length === 0}
			<EmptyState message={m.member_account_message()} />
		{:else}
			<Table size="md" zebra={false}>
				{#snippet head()}
					<th>{m.member_account_notification()}</th>
					<th class="w-20 text-center">
						<span class="tooltip" data-tip={m.member_email()}><IconMail size={16} /></span>
						<span class="sr-only">{m.member_email()}</span>
					</th>
					<th class="w-20 text-center">
						<span class="tooltip" data-tip={m.member_account_app()}><IconBell size={16} /></span>
						<span class="sr-only">{m.member_account_app()}</span>
					</th>
				{/snippet}
				{#each notifPrefs as pref (pref.key)}
					<tr>
						<td>
							<div>
								<p class="text-sm font-medium">{pref.label}</p>
								<p class="text-subtle">{pref.description}</p>
							</div>
						</td>
						<td class="w-20 text-center">
							<input
								type="checkbox"
								class="toggle toggle-primary toggle-sm"
								checked={pref.email}
								aria-label={m.member_account_email_notifications({ label: pref.label })}
								onchange={() =>
									setNotificationPreference({
										notificationType: pref.key,
										email: !pref.email,
										inApp: pref.inApp
									})}
							/>
						</td>
						<td class="w-20 text-center">
							<input
								type="checkbox"
								class="toggle toggle-primary toggle-sm"
								checked={pref.inApp}
								aria-label={m.member_account_app_notifications({ label: pref.label })}
								onchange={() =>
									setNotificationPreference({
										notificationType: pref.key,
										email: pref.email,
										inApp: !pref.inApp
									})}
							/>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<!-- Direct messaging -->
	<svelte:boundary>
		<DirectMessagesSection />

		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getMyMessagingSettings(), reset)}>
				{m.member_account_direct_message_settings_didn_t()}
			</Alert>
		{/snippet}
	</svelte:boundary>

	<EmailSubscriptionsSection />

	<!-- Security -->
	<InfoCard title={m.member_account_security()}>
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<p class="text-muted">{m.member_account_change_account_password()}</p>
				<Action
					action={changePassword}
					label={m.member_account_change_password()}
					modalTitle={m.member_account_change_password()}
					onsuccess={() => toast.success(m.member_account_password_changed())}
					variant="default"
					size="sm"
					outline
				>
					{#snippet form()}
						<FormField
							field={changePassword.fields.currentPassword}
							type="password"
							label={m.member_account_current_password()}
							autocomplete="current-password"
						/>
						<FormField
							field={changePassword.fields.newPassword}
							type="password"
							label={m.member_account_new_password()}
							autocomplete="new-password"
						/>
						<FormField
							field={changePassword.fields.confirmPassword}
							type="password"
							label={m.member_account_confirm_new_password()}
							autocomplete="new-password"
						/>
					{/snippet}
				</Action>
			</div>

			<div class="divider my-0"></div>

			<div class="flex items-center justify-between">
				{#if data.isStaff}
					<p class="text-muted">{m.member_account_contact_admin_delete_account()}</p>
					<span class="btn btn-disabled btn-error btn-sm">{m.member_account_delete_account()}</span>
				{:else}
					<p class="text-muted">{m.member_account_permanently_delete_account_all_associated()}</p>
					<Action
						action={deleteAccount}
						label={m.member_account_delete_account()}
						modalTitle={m.member_account_delete_account()}
						submitLabel={m.member_account_submit_label()}
						variant="error"
						size="sm"
						onsuccess={() => {
							toast.success(m.member_account_account_deleted());
							goto(resolve('login'));
						}}
					>
						{#snippet form()}
							<Alert type="error">
								{m.member_account_action_permanent_deleting_account_will()}
							</Alert>

							<FormField
								field={deleteAccount.fields.password}
								type="password"
								label={m.member_account_enter_password_confirm()}
								autocomplete="current-password"
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		</div>
	</InfoCard>
</PageContent>
