<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { formatDollars } from '#lib/utils/format.js';
	import {
		getPracticeSpaceSettingsPage,
		updateProduct,
		updateReservationSettings,
		updateOrientationSettings,
		updateVenueSettings
	} from '#lib/remote/settings.remote.js';

	// The space's own settings, moved out of global Settings (#2586). One query.
	const settings = $derived(await getPracticeSpaceSettingsPage());
	const products = $derived(settings.products);
	const reservationSettings = $derived(settings.reservation);
	const orientation = $derived(settings.orientation);
	const venue = $derived(settings.venue);

	const { fields: reservationFields } = updateReservationSettings;
</script>

<PageHeader width="2xl" title={m.staff_reservations_settings_title()} />

<PageContent width="2xl">
	<div class="space-y-4">
		<section id="pricing" class="space-y-4" data-testid="pricing-settings">
			<p class="text-muted">
				{m.staff_settings_configure_products_pricing_used_checkout_text()}
			</p>

			{#each products as product (product.key)}
				{@const isFee = product.key === 'fee_coverage'}
				{@const instance = updateProduct.for(product.key)}
				<Form
					remote={instance}
					successToast={m.staff_settings_updated_toast({ name: product.name })}
				>
					<Card>
						<CardBody>
							<div class="flex items-center justify-between">
								<CardTitle size="base">{product.name}</CardTitle>
								<SubmitButton
									label={m.staff_settings_save_label()}
									successLabel={m.staff_settings_saved_label()}
									errorLabel={m.staff_settings_error_label()}
									variant="primary"
									size="sm"
								/>
							</div>

							{#if product.stripeProductId}
								<p class="font-mono text-subtle">{product.stripeProductId}</p>
							{:else}
								<p class="text-subtle">
									{m.staff_settings_stripe_product_will_created_first_text()}
								</p>
							{/if}

							<input {...instance.fields.key.as('hidden', product.key)} />

							<div class="mt-2 grid gap-4 sm:grid-cols-2">
								<div class="fieldset">
									<label class="label" for="name-{product.key}">
										<span class="fieldset-legend">{m.staff_settings_product_name_label()}</span>
									</label>
									{#each instance.fields.name.issues() ?? [] as issue (issue.message)}
										<p class="text-sm text-error">{issue.message}</p>
									{/each}
									<input
										id="name-{product.key}"
										{...instance.fields.name.as('text', product.name)}
										type="text"
										class="input input-sm"
									/>
								</div>

								{#if !isFee}
									<div class="fieldset">
										<label class="label" for="amount-{product.key}">
											<span class="fieldset-legend">
												{m.staff_settings_amount_label({
													unitLabel: product.unitLabel ?? m.staff_settings_per_unit_text()
												})}
											</span>
										</label>
										{#each instance.fields.unitAmountCents.issues() ?? [] as issue (issue.message)}
											<p class="text-sm text-error">{issue.message}</p>
										{/each}
										<label class="input flex items-center gap-1 input-sm">
											<span class="opacity-60">$</span>
											<input
												id="amount-{product.key}"
												type="number"
												step="0.01"
												min="0"
												value={formatDollars(product.unitAmountCents)}
												oninput={(e) => {
													const input = e.target as HTMLInputElement;
													const dollars = parseFloat(input.value);
													const hidden = input
														.closest('form')
														?.querySelector<HTMLInputElement>(
															`[name="${instance.fields.unitAmountCents.as('hidden', '').name}"]`
														);
													if (hidden && !isNaN(dollars))
														hidden.value = String(Math.round(dollars * 100));
												}}
												class="grow bg-transparent outline-none"
											/>
										</label>
										<input
											{...instance.fields.unitAmountCents.as(
												'hidden',
												String(product.unitAmountCents)
											)}
										/>
									</div>
								{:else}
									<input {...instance.fields.unitAmountCents.as('hidden', '0')} />
								{/if}
							</div>

							<div class="mt-2 fieldset">
								<label class="label" for="desc-{product.key}">
									<span class="fieldset-legend">{m.staff_settings_description_label()}</span>
								</label>
								<textarea
									id="desc-{product.key}"
									{...instance.fields.description.as('text', product.description ?? '')}
									class="textarea textarea-sm"
									rows="2"></textarea>
							</div>
						</CardBody>
					</Card>
				</Form>
			{/each}
			<p class="text-muted">
				{m.staff_settings_configure_operating_hours_booking_rules_text()}
			</p>

			<Form
				remote={updateReservationSettings}
				guard
				successToast={m.staff_settings_reservation_settings_updated_toast()}
			>
				<Card>
					<CardBody>
						<CardTitle size="base">{m.staff_settings_pricing_title()}</CardTitle>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<div class="fieldset">
								<label class="label" for="hourlyRate">
									<span class="fieldset-legend">{m.staff_settings_hourly_rate_label()}</span>
								</label>
								<label class="input flex items-center gap-1 input-sm">
									<span class="opacity-60">$</span>
									<input
										id="hourlyRate"
										type="number"
										step="0.01"
										min="0"
										value={formatDollars(Number(reservationSettings.hourlyRateCents ?? 1500))}
										oninput={(e) => {
											const input = e.target as HTMLInputElement;
											const dollars = parseFloat(input.value);
											const hidden = input
												.closest('form')
												?.querySelector<HTMLInputElement>(
													`[name="${reservationFields.hourlyRateCents.as('hidden', '').name}"]`
												);
											if (hidden && !isNaN(dollars))
												hidden.value = String(Math.round(dollars * 100));
										}}
										class="grow bg-transparent outline-none"
									/>
								</label>
								<input
									{...reservationFields.hourlyRateCents.as(
										'hidden',
										String(reservationSettings.hourlyRateCents ?? 1500)
									)}
								/>
							</div>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">{m.staff_settings_operating_hours_title()}</CardTitle>
						</div>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateReservationSettings.fields.operatingHoursStart}
								label={m.staff_settings_opens_at_label()}
								type="time"
								value={String(reservationSettings.operatingHoursStart ?? '09:00')}
							/>
							<FormField
								field={updateReservationSettings.fields.operatingHoursEnd}
								label={m.staff_settings_closes_at_label()}
								type="time"
								value={String(reservationSettings.operatingHoursEnd ?? '22:00')}
							/>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<CardTitle size="base">{m.staff_settings_booking_rules_title()}</CardTitle>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateReservationSettings.fields.timeSlotMinutes}
								label={m.staff_settings_time_slot_granularity_label()}
								type="select"
								value={String(reservationSettings.timeSlotMinutes ?? 30)}
								options={[
									{ value: '15', label: m.staff_settings_15_minutes_label() },
									{ value: '30', label: m.staff_settings_30_minutes_label() },
									{ value: '60', label: m.staff_settings_60_minutes_label() }
								]}
							/>
							<FormField
								field={updateReservationSettings.fields.bufferMinutes}
								submitAs="text"
								label={m.staff_settings_buffer_between_reservations_min_label()}
								type="number"
								value={String(reservationSettings.bufferMinutes ?? 0)}
								min="0"
								step="5"
							/>
							<FormField
								field={updateReservationSettings.fields.minAdvanceMinutes}
								submitAs="text"
								label={m.staff_settings_min_advance_booking_minutes_label()}
								type="number"
								value={String(reservationSettings.minAdvanceMinutes ?? 60)}
								min="0"
								step="15"
							/>
							<FormField
								field={updateReservationSettings.fields.newMemberMinAdvanceMinutes}
								submitAs="text"
								label={m.staff_settings_first_booking_notice_minutes_label()}
								type="number"
								value={String(reservationSettings.newMemberMinAdvanceMinutes ?? 4320)}
								min="0"
								step="60"
								description={m.staff_settings_first_booking_notice_minutes_body()}
							/>
							<FormField
								field={updateReservationSettings.fields.minDurationHours}
								submitAs="text"
								label={m.staff_settings_minimum_duration_hours_label()}
								type="number"
								value={String(reservationSettings.minDurationHours ?? 1)}
								min="0.5"
								step="0.5"
							/>
							<FormField
								field={updateReservationSettings.fields.maxDurationHours}
								submitAs="text"
								label={m.staff_settings_maximum_duration_hours_label()}
								type="number"
								value={String(reservationSettings.maxDurationHours ?? 8)}
								min="1"
								step="1"
							/>
							<FormField
								field={updateReservationSettings.fields.maxAdvanceDaysOneoff}
								submitAs="text"
								label={m.staff_settings_max_advance_booking_one_off_label()}
								type="number"
								value={String(reservationSettings.maxAdvanceDaysOneoff ?? 14)}
								min="1"
							/>
							<FormField
								field={updateReservationSettings.fields.maxAdvanceDaysRecurring}
								submitAs="text"
								label={m.staff_settings_max_advance_booking_recurring_days_label()}
								type="number"
								value={String(reservationSettings.maxAdvanceDaysRecurring ?? 17.5)}
								min="1"
								step="0.5"
							/>
						</div>
					</CardBody>
				</Card>
				<!-- One form, one Save, named for what it saves. The button used to sit
			     in the first card's header while the form wrapped three of them, so
			     editing an operating hour or a social URL offered no save control in
			     the card you were editing (#1076). Three buttons would have been
			     worse: each one saves all of it. -->
				<div class="flex justify-end">
					<SubmitButton
						label={m.staff_settings_save_reservation_settings_label()}
						successLabel={m.staff_settings_saved_label()}
						errorLabel={m.staff_settings_error_label()}
						variant="primary"
					/>
				</div>
			</Form>
		</section>
		<section id="space" class="space-y-4" data-testid="space-settings">
			<Form
				remote={updateOrientationSettings}
				guard
				successToast={m.staff_settings_orientation_updated_toast()}
			>
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">{m.staff_settings_orientation_title()}</CardTitle>
							<SubmitButton
								label={m.staff_settings_save_label()}
								successLabel={m.staff_settings_saved_label()}
								errorLabel={m.staff_settings_error_label()}
								variant="primary"
								size="sm"
							/>
						</div>
						<p class="text-subtle">
							{m.staff_settings_member_s_first_rehearsal_booking_text()}
						</p>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateOrientationSettings.fields.roleId}
								label={m.staff_settings_role_label()}
								type="select"
								value={orientation.roleId}
								options={[
									{ value: '', label: m.staff_settings_none_label() },
									...orientation.roles.map((r) => ({ value: r.id, label: r.name }))
								]}
							/>
							<FormField
								field={updateOrientationSettings.fields.minutes}
								submitAs="text"
								label={m.staff_settings_length_minutes_label()}
								type="number"
								value={String(orientation.minutes)}
							/>
							<FormField
								field={updateOrientationSettings.fields.leadMinutes}
								submitAs="text"
								label={m.staff_settings_starts_before_booking_minutes_label()}
								type="number"
								value={String(orientation.leadMinutes)}
							/>
						</div>
						<FormField
							field={updateOrientationSettings.fields.tasks}
							label={m.staff_settings_checklist_label()}
							type="textarea"
							description={m.staff_settings_one_task_per_line_body()}
							value={orientation.tasks.join('\n')}
						/>
						<FormField
							field={updateOrientationSettings.fields.firstVisitNotes}
							label={m.staff_settings_first_visit_notes_label()}
							type="textarea"
							description={m.staff_settings_first_visit_notes_body()}
							value={orientation.firstVisitNotes}
						/>
					</CardBody>
				</Card>
			</Form>

			<Form
				remote={updateVenueSettings}
				guard
				successToast={m.staff_settings_room_settings_updated_toast()}
			>
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">{m.staff_settings_room_title()}</CardTitle>
							<SubmitButton
								label={m.staff_settings_save_label()}
								successLabel={m.staff_settings_saved_label()}
								errorLabel={m.staff_settings_error_label()}
								variant="primary"
								size="sm"
							/>
						</div>
						<p class="text-subtle">
							{m.staff_settings_how_many_inputs_desk_can_text()}
						</p>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateVenueSettings.fields.consoleChannels}
								submitAs="text"
								label={m.staff_settings_console_channels_label()}
								type="number"
								value={String(venue.consoleChannels)}
								placeholder="16"
							/>
						</div>
					</CardBody>
				</Card>
			</Form>
		</section>
	</div>
</PageContent>
