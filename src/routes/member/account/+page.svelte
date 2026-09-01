<script lang="ts">
	import DirectMessagesSection from './DirectMessagesSection.svelte';
	import EmailSubscriptionsSection from './EmailSubscriptionsSection.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Action from '$lib/components/ui/Action.svelte';
	import { IconMail, IconBell } from '@tabler/icons-svelte';
	import { updateProfile, changePassword, deleteAccount } from '$lib/remote/account.remote';
	import {
		getMemberAccountPage,
		setNotificationPreference
	} from '$lib/remote/notifications.remote';

	const pageData = $derived(await getMemberAccountPage());
	const data = $derived(pageData.account);
	const notifPrefs = $derived(pageData.notificationPreferences);

	const { fields } = updateProfile;
</script>

<PageHeader title="Account Settings" />
<PageContent width="2xl">
	<!-- Profile info -->
	<InfoCard title="Contact Information">
		<Form
			remote={updateProfile}
			guard
			onsuccess={() => toast.success('Contact info updated')}
			onfailure={() => toast.error('Update failed')}
		>
			<div class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<FormField field={fields.name} type="text" label="Name" value={data.user.name} required />
					<FormField
						field={fields.pronouns}
						type="text"
						label="Pronouns"
						value={data.user.pronouns ?? ''}
						placeholder="e.g. they/them"
					/>
				</div>

				<FormField
					type="email"
					label="Email"
					value={data.user.email}
					readonly
					description="Contact staff to change your email address."
				/>

				<FormField
					field={fields.phone}
					type="tel"
					label="Phone"
					value={data.user.phone ?? ''}
					placeholder="(541) 555-0123"
				/>

				<div class="flex justify-end pt-2">
					<SubmitButton label="Save" successLabel="Saved" variant="primary" shortcut="mod+s" />
				</div>
			</div>
		</Form>
	</InfoCard>

	<!-- Notification preferences -->
	<InfoCard title="Notification Preferences">
		{#if notifPrefs.length === 0}
			<EmptyState message="No notification preferences available." />
		{:else}
			<Table size="md" zebra={false}>
				{#snippet head()}
					<th>Notification</th>
					<th class="w-20 text-center">
						<span class="tooltip" data-tip="Email"><IconMail size={16} /></span>
						<span class="sr-only">Email</span>
					</th>
					<th class="w-20 text-center">
						<span class="tooltip" data-tip="In-app"><IconBell size={16} /></span>
						<span class="sr-only">In-app</span>
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
								aria-label={`Email notifications for ${pref.label}`}
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
								aria-label={`In-app notifications for ${pref.label}`}
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
	<DirectMessagesSection />

	<EmailSubscriptionsSection />

	<!-- Security -->
	<InfoCard title="Security">
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<p class="text-muted">Change your account password.</p>
				<Action
					action={changePassword}
					label="Change Password"
					modalTitle="Change Password"
					onsuccess={() => toast.success('Password changed')}
					onfailure={() => toast.error('Password change failed')}
					variant="default"
					size="sm"
					outline
				>
					{#snippet form()}
						<FormField
							name="currentPassword"
							type="password"
							label="Current password"
							autocomplete="current-password"
						/>
						<FormField
							name="newPassword"
							type="password"
							label="New password"
							autocomplete="new-password"
						/>
						<FormField
							name="confirmPassword"
							type="password"
							label="Confirm new password"
							autocomplete="new-password"
						/>
					{/snippet}
				</Action>
			</div>

			<div class="divider my-0"></div>

			<div class="flex items-center justify-between">
				{#if data.isStaff}
					<p class="text-muted">Contact an admin to delete your account.</p>
					<span class="btn btn-disabled btn-error btn-sm">Delete Account</span>
				{:else}
					<p class="text-muted">Permanently delete your account and all associated data.</p>
					<Action
						action={deleteAccount}
						label="Delete Account"
						modalTitle="Delete Account"
						submitLabel="Delete My Account"
						onfailure={() => toast.error('Deletion failed')}
						variant="error"
						size="sm"
						onsuccess={() => {
							toast.success('Account deleted');
							goto(resolve('/login'));
						}}
					>
						{#snippet form()}
							<Alert type="error">
								This action is permanent. Deleting your account will cancel all of your current and
								future reservations and end your subscription. This cannot be undone.
							</Alert>

							<FormField
								name="password"
								type="password"
								label="Enter your password to confirm"
								autocomplete="current-password"
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		</div>
	</InfoCard>
</PageContent>
