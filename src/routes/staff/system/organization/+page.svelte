<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { getOrgSettings, updateOrgSettings } from '#lib/remote/settings.remote.js';
	import { fieldsState, linksState } from '../../section-state';

	const orgSettings = $derived(await getOrgSettings());
	const location = $derived([
		orgSettings.addressStreet,
		orgSettings.addressCity,
		orgSettings.addressState,
		orgSettings.addressZip
	]);
</script>

<PageHeader
	width="2xl"
	title={m.staff_settings_organization_title()}
	subtitle={m.staff_settings_organization_identity_used_emails_branding_body()}
/>

<PageContent width="2xl">
	<div class="space-y-4">
		<Form
			remote={updateOrgSettings}
			guard
			successToast={m.staff_settings_organization_settings_updated_toast()}
		>
			<InfoCard title={m.staff_settings_location_title()} state={fieldsState(location)}>
				<p class="text-subtle">{m.staff_settings_shown_site_footer_contact_page_text()}</p>

				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateOrgSettings.fields.addressStreet}
						label={m.staff_settings_street_address_label()}
						type="text"
						value={String(orgSettings.addressStreet ?? '')}
						placeholder={m.staff_settings_6775_sw_philomath_blvd_placeholder()}
					/>
					<FormField
						field={updateOrgSettings.fields.addressCity}
						label={m.staff_settings_city_label()}
						type="text"
						value={String(orgSettings.addressCity ?? '')}
						placeholder={m.staff_settings_corvallis_placeholder()}
					/>
					<FormField
						field={updateOrgSettings.fields.addressState}
						label={m.staff_settings_state_label()}
						type="text"
						value={String(orgSettings.addressState ?? '')}
						placeholder={m.staff_settings_text_placeholder()}
					/>
					<FormField
						field={updateOrgSettings.fields.addressZip}
						label={m.staff_settings_zip_label()}
						type="text"
						value={String(orgSettings.addressZip ?? '')}
						placeholder="97333"
					/>
				</div>
			</InfoCard>

			<InfoCard
				title={m.staff_settings_contact_email_title()}
				state={fieldsState([orgSettings.contactEmail])}
			>
				<p class="text-subtle">{m.staff_settings_contact_email_shown_text()}</p>

				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateOrgSettings.fields.contactEmail}
						label={m.staff_settings_contact_email_label()}
						type="email"
						value={String(orgSettings.contactEmail ?? '')}
						required
					/>
				</div>
			</InfoCard>

			<InfoCard
				title={m.staff_settings_social_links_title()}
				state={linksState([orgSettings.socialFacebook, orgSettings.socialInstagram])}
			>
				<p class="text-subtle">{m.staff_settings_shown_site_footer_leave_blank_text()}</p>

				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateOrgSettings.fields.socialFacebook}
						label={m.staff_settings_facebook_url_label()}
						type="text"
						value={String(orgSettings.socialFacebook ?? '')}
						placeholder={m.staff_settings_https_facebook_com_placeholder()}
					/>
					<FormField
						field={updateOrgSettings.fields.socialInstagram}
						label={m.staff_settings_instagram_url_label()}
						type="text"
						value={String(orgSettings.socialInstagram ?? '')}
						placeholder={m.staff_settings_https_instagram_com_placeholder()}
					/>
				</div>
			</InfoCard>
			<!-- One form, one Save, named for what it saves. The button used to sit
			     in the first card's header while the form wrapped three of them, so
			     editing an operating hour or a social URL offered no save control in
			     the card you were editing (#1076). Three buttons would have been
			     worse: each one saves all of it. -->
			<div class="flex justify-end">
				<SubmitButton
					label={m.staff_settings_save_organization_settings_label()}
					successLabel={m.staff_settings_saved_label()}
					errorLabel={m.staff_settings_error_label()}
					variant="primary"
				/>
			</div>
		</Form>
	</div>
</PageContent>
