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

<PageHeader width="2xl" title={m.member_account_account_settings_title()} />
<PageContent width="2xl">
	<!-- Profile info -->
	<InfoCard title={m.member_account_contact_information_title()}>
		<Form
			remote={updateProfile}
			guard
			onsuccess={() => toast.success(m.member_account_contact_info_updated_toast())}
		>
			<div class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<FormField
						field={fields.name}
						type="text"
						label={m.member_name_label()}
						value={data.user.name}
						required
					/>
					<FormField
						field={fields.pronouns}
						type="text"
						label={m.member_pronouns_label()}
						value={data.user.pronouns ?? ''}
						placeholder={m.member_account_placeholder()}
					/>
				</div>

				<FormField
					type="email"
					label={m.member_email_label()}
					value={data.user.email}
					readonly
					description={m.member_account_contact_staff_change_email_address_body()}
				/>

				<!-- Nothing on the site is gated on this. Confirming is what lets us
				     attach a mailing list this address was already on (#757). -->
				{#if !data.user.emailVerified}
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
				{/if}

				<FormField
					field={fields.phone}
					type="tel"
					label={m.member_phone_label()}
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
						label={m.member_account_date_birth_label()}
						value={toBirthDateInput(data.user.dateOfBirth)}
						readonly
						description={m.member_account_contact_staff_if_wrong_body()}
					/>
				{:else}
					<FormField
						field={fields.dateOfBirth}
						type="date"
						label={m.member_account_date_birth_label()}
						value=""
						description={m.member_account_optional_few_things_direct_messages_body({
							ADULT_AGE_YEARS
						})}
					/>
				{/if}

				<div class="flex justify-end pt-2">
					<SubmitButton
						label={m.member_save_label()}
						successLabel={m.member_saved_label()}
						variant="primary"
						shortcut="mod+s"
					/>
				</div>
			</div>
		</Form>
	</InfoCard>

	<!-- Notification preferences -->
	<InfoCard title={m.member_account_notification_preferences_title()}>
		{#if notifPrefs.length === 0}
			<EmptyState message={m.member_account_message_body()} />
		{:else}
			<Table size="md" zebra={false}>
				{#snippet head()}
					<th>{m.member_account_notification_label()}</th>
					<th class="w-20 text-center">
						<span class="tooltip" data-tip={m.member_email_label()}><IconMail size={16} /></span>
						<span class="sr-only">{m.member_email_label()}</span>
					</th>
					<th class="w-20 text-center">
						<span class="tooltip" data-tip={m.member_account_app_label()}
							><IconBell size={16} /></span
						>
						<span class="sr-only">{m.member_account_app_label()}</span>
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
								aria-label={m.member_account_email_notifications_label({ label: pref.label })}
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
								aria-label={m.member_account_app_notifications_label({ label: pref.label })}
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
				{m.member_account_direct_message_settings_didn_t_body()}
			</Alert>
		{/snippet}
	</svelte:boundary>

	<EmailSubscriptionsSection />

	<!-- Security -->
	<InfoCard title={m.member_account_security_title()}>
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<p class="text-muted">{m.member_account_change_account_password_text()}</p>
				<Action
					action={changePassword}
					label={m.member_account_change_password_label()}
					modalTitle={m.member_account_change_password_title()}
					onsuccess={() => toast.success(m.member_account_password_changed_toast())}
					variant="default"
					size="sm"
					outline
				>
					{#snippet form()}
						<FormField
							field={changePassword.fields.currentPassword}
							type="password"
							label={m.member_account_current_password_label()}
							autocomplete="current-password"
						/>
						<FormField
							field={changePassword.fields.newPassword}
							type="password"
							label={m.member_account_new_password_label()}
							autocomplete="new-password"
						/>
						<FormField
							field={changePassword.fields.confirmPassword}
							type="password"
							label={m.member_account_confirm_new_password_label()}
							autocomplete="new-password"
						/>
					{/snippet}
				</Action>
			</div>

			<div class="divider my-0"></div>

			<div class="flex items-center justify-between">
				{#if data.isStaff}
					<p class="text-muted">{m.member_account_contact_admin_delete_account_text()}</p>
					<span class="btn btn-disabled btn-error btn-sm"
						>{m.member_account_delete_account_text()}</span
					>
				{:else}
					<p class="text-muted">
						{m.member_account_permanently_delete_account_all_associated_text()}
					</p>
					<Action
						action={deleteAccount}
						label={m.member_account_delete_account_label()}
						modalTitle={m.member_account_delete_account_title()}
						submitLabel={m.member_account_submit_label()}
						variant="error"
						size="sm"
						onsuccess={() => {
							toast.success(m.member_account_account_deleted_toast());
							goto(resolve('login'));
						}}
					>
						{#snippet form()}
							<Alert type="error">
								{m.member_account_action_permanent_deleting_account_will_body()}
							</Alert>

							<FormField
								field={deleteAccount.fields.password}
								type="password"
								label={m.member_account_enter_password_confirm_label()}
								description={m.member_account_required_delete_account_body()}
								autocomplete="current-password"
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		</div>
	</InfoCard>
</PageContent>
