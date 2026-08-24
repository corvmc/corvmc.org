<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { getBandPageEditor, saveBandEpk } from '$lib/remote/band-page-editor.remote';
	import { page } from '$app/state';
	import type { BandEpk } from '$lib/types/band-page';

	let layout = $derived(await getBandLayout(page.params.slug!));
	let pageData = $derived(await getBandPageEditor(page.params.slug!));
	const band = $derived(layout.band);
	const isPremium = $derived(band.tier === 'premium');

	// Local EPK state for the hidden JSON field
	let epk = $state<BandEpk>(pageData.config?.epk ?? {});

	// Press quotes management
	function addPressQuote() {
		epk.pressQuotes = [...(epk.pressQuotes ?? []), { quote: '', publication: '' }];
	}
	function removePressQuote(index: number) {
		epk.pressQuotes = (epk.pressQuotes ?? []).filter((_, i) => i !== index);
	}

	// Backline management
	function addBacklineItem() {
		epk.backline = [...(epk.backline ?? []), { instrument: '', details: '', provided: true }];
	}
	function removeBacklineItem(index: number) {
		epk.backline = (epk.backline ?? []).filter((_, i) => i !== index);
	}

	// Achievements management
	function addAchievement() {
		epk.achievements = [...(epk.achievements ?? []), ''];
	}
	function removeAchievement(index: number) {
		epk.achievements = (epk.achievements ?? []).filter((_, i) => i !== index);
	}

	const epkJson = $derived(JSON.stringify(epk));
</script>

<PageHeader title="Electronic Press Kit" subtitle={band.name} />
<PageContent width="2xl">
	{#if !isPremium}
		<EmptyState>
			<p class="text-lg font-medium">Premium Feature</p>
			<p class="mt-2 opacity-70">The EPK editor is available with a premium band subscription.</p>
			<Button href="../../../subscription" variant="primary" class="mt-4">Upgrade to Premium</Button
			>
		</EmptyState>
	{:else}
		<form
			{...saveBandEpk.enhance(async (form) => {
				try {
					if (await form.submit()) {
						toast.success('EPK saved');
						invalidateAll();
					}
				} catch {
					toast.error('Failed to save EPK');
				}
			})}
		>
			<input {...saveBandEpk.fields.slug.as('hidden', band.slug)} />
			<input {...saveBandEpk.fields.epk.as('hidden', epkJson)} />

			<div class="space-y-6">
				<!-- Contacts -->
				<Card>
					<CardBody>
						<CardTitle size="lg" level={2}>Contacts</CardTitle>
						<p class="text-muted">Industry contacts shown on your EPK page.</p>

						<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
							<!-- Booking -->
							<div class="space-y-2">
								<h3 class="font-semibold text-sm">Booking</h3>
								<input
									type="text"
									class="input input-sm w-full"
									placeholder="Name"
									value={epk.bookingContact?.name ?? ''}
									oninput={(e) => {
										epk.bookingContact = {
											...(epk.bookingContact ?? { name: '', email: '' }),
											name: e.currentTarget.value
										};
									}}
								/>
								<input
									type="email"
									class="input input-sm w-full"
									placeholder="Email"
									value={epk.bookingContact?.email ?? ''}
									oninput={(e) => {
										epk.bookingContact = {
											...(epk.bookingContact ?? { name: '', email: '' }),
											email: e.currentTarget.value
										};
									}}
								/>
								<input
									type="tel"
									class="input input-sm w-full"
									placeholder="Phone (optional)"
									value={epk.bookingContact?.phone ?? ''}
									oninput={(e) => {
										epk.bookingContact = {
											...(epk.bookingContact ?? { name: '', email: '' }),
											phone: e.currentTarget.value || undefined
										};
									}}
								/>
							</div>

							<!-- Management -->
							<div class="space-y-2">
								<h3 class="font-semibold text-sm">Management</h3>
								<input
									type="text"
									class="input input-sm w-full"
									placeholder="Name"
									value={epk.managementContact?.name ?? ''}
									oninput={(e) => {
										epk.managementContact = {
											...(epk.managementContact ?? { name: '', email: '' }),
											name: e.currentTarget.value
										};
									}}
								/>
								<input
									type="email"
									class="input input-sm w-full"
									placeholder="Email"
									value={epk.managementContact?.email ?? ''}
									oninput={(e) => {
										epk.managementContact = {
											...(epk.managementContact ?? { name: '', email: '' }),
											email: e.currentTarget.value
										};
									}}
								/>
							</div>

							<!-- Press -->
							<div class="space-y-2">
								<h3 class="font-semibold text-sm">Press / PR</h3>
								<input
									type="text"
									class="input input-sm w-full"
									placeholder="Name"
									value={epk.prContact?.name ?? ''}
									oninput={(e) => {
										epk.prContact = {
											...(epk.prContact ?? { name: '', email: '' }),
											name: e.currentTarget.value
										};
									}}
								/>
								<input
									type="email"
									class="input input-sm w-full"
									placeholder="Email"
									value={epk.prContact?.email ?? ''}
									oninput={(e) => {
										epk.prContact = {
											...(epk.prContact ?? { name: '', email: '' }),
											email: e.currentTarget.value
										};
									}}
								/>
							</div>
						</div>
					</CardBody>
				</Card>

				<!-- Press Quotes -->
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="lg" level={2}>Press Quotes</CardTitle>
							<Button type="button" variant="primary" size="sm" onclick={addPressQuote}
								>Add Quote</Button
							>
						</div>

						{#if !epk.pressQuotes || epk.pressQuotes.length === 0}
							<p class="text-muted mt-2">No press quotes yet.</p>
						{:else}
							<div class="space-y-3 mt-4">
								{#each epk.pressQuotes as quote, i (i)}
									<div class="flex gap-2 items-start p-3 bg-base-200 rounded-lg">
										<div class="flex-1 space-y-2">
											<textarea
												class="textarea textarea-sm w-full"
												rows="2"
												placeholder="Quote text..."
												value={quote.quote}
												oninput={(e) => {
													epk.pressQuotes![i] = { ...quote, quote: e.currentTarget.value };
												}}
											></textarea>
											<div class="grid grid-cols-2 gap-2">
												<input
													type="text"
													class="input input-sm"
													placeholder="Publication"
													value={quote.publication}
													oninput={(e) => {
														epk.pressQuotes![i] = { ...quote, publication: e.currentTarget.value };
													}}
												/>
												<input
													type="text"
													class="input input-sm"
													placeholder="Date (optional)"
													value={quote.date ?? ''}
													oninput={(e) => {
														epk.pressQuotes![i] = {
															...quote,
															date: e.currentTarget.value || undefined
														};
													}}
												/>
											</div>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											shape="square"
											onclick={() => removePressQuote(i)}>✕</Button
										>
									</div>
								{/each}
							</div>
						{/if}
					</CardBody>
				</Card>

				<!-- Achievements -->
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="lg" level={2}>Achievements</CardTitle>
							<Button type="button" variant="primary" size="sm" onclick={addAchievement}>Add</Button
							>
						</div>
						<p class="text-muted">
							Awards, notable supports, festival appearances, streaming milestones.
						</p>

						{#if !epk.achievements || epk.achievements.length === 0}
							<p class="text-muted mt-2">No achievements yet.</p>
						{:else}
							<div class="space-y-2 mt-4">
								{#each epk.achievements as achievement, i (i)}
									<div class="flex gap-2 items-center">
										<input
											type="text"
											class="input input-sm flex-1"
											placeholder="e.g. Opened for The National (2024)"
											value={achievement}
											oninput={(e) => {
												epk.achievements![i] = e.currentTarget.value;
											}}
										/>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											shape="square"
											onclick={() => removeAchievement(i)}>✕</Button
										>
									</div>
								{/each}
							</div>
						{/if}
					</CardBody>
				</Card>

				<!-- Backline Requirements -->
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="lg" level={2}>Backline Requirements</CardTitle>
							<Button type="button" variant="primary" size="sm" onclick={addBacklineItem}
								>Add Item</Button
							>
						</div>
						<p class="text-muted">Equipment you need from the venue vs. what you bring.</p>

						{#if !epk.backline || epk.backline.length === 0}
							<p class="text-muted mt-2">No backline items yet.</p>
						{:else}
							<div class="overflow-x-auto mt-4">
								<table class="table table-sm">
									<thead>
										<tr>
											<th>Instrument</th>
											<th>Details</th>
											<th>Provided by</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										{#each epk.backline as item, i (i)}
											<tr>
												<td>
													<input
														type="text"
														class="input input-sm w-full"
														placeholder="e.g. Drums"
														value={item.instrument}
														oninput={(e) => {
															epk.backline![i] = { ...item, instrument: e.currentTarget.value };
														}}
													/>
												</td>
												<td>
													<input
														type="text"
														class="input input-sm w-full"
														placeholder="e.g. 5-piece kit, 22&quot; kick"
														value={item.details}
														oninput={(e) => {
															epk.backline![i] = { ...item, details: e.currentTarget.value };
														}}
													/>
												</td>
												<td>
													<Select
														size="sm"
														value={item.provided ? 'band' : 'venue'}
														onchange={(e: Event) => {
															epk.backline![i] = {
																...item,
																provided: (e.currentTarget as HTMLSelectElement).value === 'band'
															};
														}}
													>
														<option value="band">Band</option>
														<option value="venue">Venue</option>
													</Select>
												</td>
												<td>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														shape="square"
														onclick={() => removeBacklineItem(i)}>✕</Button
													>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</CardBody>
				</Card>

				<!-- Save -->
				<div class="flex justify-end gap-3">
					<Button href={resolve(`/band/${band.slug}/page-editor`)} variant="ghost"
						>Back to Page Editor</Button
					>
					<Button variant="primary">Save EPK</Button>
				</div>
			</div>
		</form>
	{/if}
</PageContent>
