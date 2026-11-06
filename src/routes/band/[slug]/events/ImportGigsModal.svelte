<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { importGigsForm } from '#lib/remote/band-events.remote.js';
	import { parseGigImport, GIG_IMPORT_MAX_LINES } from '#lib/utils/gig-import.js';
	import { refreshAll } from '$app/navigation';

	// The `slug` is back to being read. It used to ride the form and be ignored,
	// because the guard resolved the band from the route instead; now it is the
	// ref the guard resolves.
	let { slug, open = $bindable(false) }: { slug: string; open?: boolean } = $props();

	const fields = importGigsForm.fields;

	let text = $state('');

	// Previewed with the same parser the server uses, so what's shown here is
	// exactly what gets written — no second set of rules to drift apart.
	const preview = $derived(text.trim() ? parseGigImport(text) : { rows: [], errors: [] });
</script>

<Modal bind:open title={m.band_import_past_gigs()} maxWidth="max-w-2xl">
	<Form
		remote={importGigsForm}
		successToast={m.band_slug_events_import_gigs_modal_success_toast()}
		onsuccess={() => {
			open = false;
			text = '';
			refreshAll();
		}}
		class="space-y-4"
	>
		<input {...fields.slug.as('hidden', slug)} />

		<FormField
			field={importGigsForm.fields.text}
			label={m.band_slug_events_import_gigs_modal_one_gig_per_line()}
		>
			<textarea
				{...fields.text.as('text')}
				bind:value={text}
				class="textarea w-full font-mono text-xs"
				rows="10"
				placeholder={m.band_slug_events_import_gigs_modal_placeholder()}></textarea>
		</FormField>

		<p class="text-subtle">
			<ParaglideMessage
				message={m.band_slug_events_import_gigs_modal_date_venue_title_ticket_l}
				inputs={{ GIG_IMPORT_MAX_LINES }}
				>{#snippet code({ children })}<code>{@render children?.()}</code
					>{/snippet}</ParaglideMessage
			>
		</p>

		{#if preview.errors.length > 0}
			<div class="rounded border border-error/40 bg-error/10 p-3">
				<p class="text-sm font-medium">
					{m.band_slug_events_import_gigs_modal_these_lines_will_skipped()}
				</p>
				<ul class="mt-1 space-y-0.5 text-xs">
					{#each preview.errors as err (err.line)}
						<li>
							{m.band_slug_events_import_gigs_modal_line({ line: err.line, message: err.message })}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if preview.rows.length > 0}
			<div class="overflow-x-auto rounded border border-base-300">
				<table class="table table-xs">
					<thead>
						<tr
							><th>{m.band_date()}</th><th>{m.band_title()}</th><th>{m.band_venue()}</th><th
								>{m.band_slug_events_import_gigs_modal_with()}</th
							></tr
						>
					</thead>
					<tbody>
						{#each preview.rows as row (row.line)}
							<tr>
								<td class="tabular-nums">{row.date}</td>
								<td>{row.title}</td>
								<td class="opacity-70">{row.location ?? '—'}</td>
								<td class="opacity-70">{row.support.join(', ') || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="flex justify-end gap-2">
			<SubmitButton
				label={preview.rows.length > 0
					? m.band_slug_events_import_gigs_modal_import_gigs({ length: preview.rows.length })
					: m.band_slug_events_import_gigs_modal_import()}
				variant="primary"
				disabled={preview.rows.length === 0}
			/>
		</div>
	</Form>
</Modal>
