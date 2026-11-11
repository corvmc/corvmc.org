<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { fullDate } from '#lib/utils/format.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import { getEventInputList } from '#lib/remote/events.remote.js';
	import { riderInputSourceLabels, riderStandTypeLabels } from '#lib/config.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/**
	 * A print page, following `/band/[slug]/rider/list`, whose shape this copies:
	 * numbered, banded in eights, console order, no controls. What it adds is the
	 * thing a per-act sheet cannot say — the totals for the bill against one desk.
	 *
	 * Repeats are marked, not merged: whether three kicks are one kick is the
	 * house engineer's call.
	 */
	const eventId = $derived(params.id);
	const data = $derived(await getEventInputList(eventId));

	const banks = $derived(
		Array.from({ length: Math.ceil(data.channels.length / 8) }, (_, i) =>
			data.channels.slice(i * 8, i * 8 + 8)
		)
	);

	const overCapacity = $derived(
		data.consoleChannels > 0 && data.channelCount > data.consoleChannels
	);
	const fitsIfShared = $derived(
		overCapacity &&
			data.distinctCount <= data.consoleChannels &&
			data.distinctCount < data.channelCount
	);
	const silent = $derived(data.acts.filter((a) => a.empty));

	const exportHref = $derived(resolve('/staff/events/[id]/inputs/export', { id: eventId }));
	const backHref = $derived(resolve('/staff/events/[id]/production', { id: eventId }));
	const dateLabel = $derived(fullDate(data.startsAt));
</script>

<svelte:head>
	<title>{m.staff_events_id_inputs_input_list_title({ title: data.title })}</title>
	<style>
		@media print {
			.no-print {
				display: none !important;
			}
			body {
				font-size: 10pt;
			}
			.bill-page {
				padding: 0;
				max-width: 100%;
			}
			a {
				color: inherit;
				text-decoration: none;
			}
			/* A bank is the unit an engineer reads; splitting one across a page
			   break is the one thing this layout must not do. */
			.bank {
				break-inside: avoid;
			}
		}
	</style>
</svelte:head>

<!-- Below the app topbar, not over it: this page renders inside the staff panel
     and `top-4` would cover the account menu. -->
<div class="no-print fixed top-16 right-4 z-50 flex gap-2">
	<Button variant="primary" size="sm" onclick={() => window.print()}
		>{m.staff_events_id_inputs_print_label()}</Button
	>
	<Button href={exportHref} variant="ghost" size="sm" data-sveltekit-reload
		>{m.staff_events_id_inputs_download_csv_label()}</Button
	>
	<Button href={backHref} variant="ghost" size="sm"
		>{m.staff_events_id_inputs_production_label()}</Button
	>
</div>

<div class="bill-page mx-auto max-w-3xl">
	<header class="mb-6 border-b-2 border-gray-200 pb-4">
		<h1 class="text-3xl font-bold">{data.title}</h1>
		<p class="text-sm text-gray-600">
			{m.staff_events_id_inputs_input_list_night_text({ dateLabel })}
		</p>
		<dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-gray-500">{m.staff_channels_label()}</dt>
				<dd class="font-semibold">{data.channelCount}</dd>
			</div>
			<div>
				<dt class="text-gray-500">{m.staff_events_id_inputs_if_repeats_shared_label()}</dt>
				<dd class="font-semibold">{data.distinctCount}</dd>
			</div>
			<div>
				<dt class="text-gray-500">{m.staff_events_id_inputs_need_48v_label()}</dt>
				<dd class="font-semibold">{data.phantomCount}</dd>
			</div>
			<div>
				<dt class="text-gray-500">{m.staff_events_id_inputs_desk_takes_label()}</dt>
				<dd class="font-semibold">{data.consoleChannels || '—'}</dd>
			</div>
		</dl>
		<p class="mt-2 text-sm text-gray-600">
			{#each data.acts as act, i (act.id)}{i > 0 ? ' · ' : ''}{act.name} ({act.channelCount}){/each}
		</p>
	</header>

	{#if overCapacity}
		<p class="over-capacity mb-6">
			<ParaglideMessage
				message={m.staff_events_id_inputs_bill_asks_channels_desk_takes_text}
				inputs={{ channelCount: data.channelCount, consoleChannels: data.consoleChannels }}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
			{#if fitsIfShared}
				<ParaglideMessage
					message={m.staff_events_id_inputs_fits_at_if_every_repeated_text}
					inputs={{ distinctCount: data.distinctCount }}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
			{:else}
				<ParaglideMessage
					message={m.staff_events_id_inputs_sharing_every_repeated_source_still_text}
					inputs={{ distinctCount: data.distinctCount }}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
			{/if}
		</p>
	{/if}

	{#if silent.length}
		<p class="mb-6 text-sm text-gray-600">
			{m.staff_events_id_inputs_nothing_listed_by_sheet_cannot_text({
				join: silent.map((a) => a.name).join(', ')
			})}
		</p>
	{/if}

	{#each banks as bank, i (i)}
		<section class="bank mb-6">
			{#if banks.length > 1}
				<h2 class="section-label">
					{m.staff_events_id_inputs_channels_title({
						value: i * 8 + 1,
						value2: i * 8 + bank.length
					})}
				</h2>
			{/if}
			<table class="w-full text-sm">
				<thead>
					<tr class="head-row">
						<th class="w-8 py-1">#</th>
						<th class="py-1">{m.staff_source_label()}</th>
						<th class="py-1">{m.staff_band_label()}</th>
						<th class="py-1">{m.staff_events_id_inputs_via_label()}</th>
						<th class="py-1">{m.staff_events_id_inputs_mic_di_label()}</th>
						<th class="py-1">{m.staff_events_id_inputs_stand_label()}</th>
						<th class="w-12 py-1">{m.staff_events_id_inputs_48v_label()}</th>
					</tr>
				</thead>
				<tbody>
					{#each bank as channel (channel.inputId)}
						<tr class="border-b border-gray-100 align-top">
							<td class="py-1 font-mono">{channel.channel}</td>
							<td class="py-1">
								<span class="font-medium">{channel.label}</span>
								<span class="block text-xs text-gray-500">
									{channel.elementLabel}{channel.ownerName ? ` · ${channel.ownerName}` : ''}
								</span>
							</td>
							<td class="py-1">
								{channel.actName}
								{#if channel.sharedWith.length}
									<span class="block text-xs text-amber-700">
										{m.staff_events_id_inputs_also_text({ join: channel.sharedWith.join(', ') })}
									</span>
								{/if}
							</td>
							<td class="py-1">{riderInputSourceLabels[channel.source]}</td>
							<td class="py-1">{channel.micPref ?? '—'}</td>
							<td class="py-1">{riderStandTypeLabels[channel.stand]}</td>
							<td class="py-1">{channel.phantom ? '✓' : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/each}

	{#if data.channels.length === 0}
		<p class="text-sm text-gray-600">
			{m.staff_events_id_inputs_no_band_bill_has_listed_text()}
		</p>
	{/if}
</div>

<!--
	A print document, so the page paints its own light ground rather than
	inheriting the panel theme — the same choice `/band/[slug]/rider/list` makes.
-->
<style>
	.bill-page {
		min-height: 100vh;
		padding: 3rem 2rem;
		background: #fff;
		color: #111827;
	}

	.section-label {
		margin-bottom: 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6b7280;
	}

	.head-row {
		border-bottom: 1px solid #d1d5db;
		text-align: left;
		font-size: 0.75rem;
		text-transform: uppercase;
		color: #6b7280;
	}

	.over-capacity {
		border-left: 4px solid #f59e0b;
		background: #fffbeb;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
	}
</style>
