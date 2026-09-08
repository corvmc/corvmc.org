<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import FormField from './FormField.svelte';

	// The gallery this file exists for: one canvas showing every `type` at once,
	// so a change to the shared wrapper is checked against all of them rather
	// than against whichever field the author happened to be editing.
	const { Story } = defineMeta({
		title: 'Shared/Form/FormField',
		component: FormField,
		tags: ['autodocs'],
		parameters: { layout: 'padded' },
		args: { name: 'subject', label: 'Subject' }
	});

	const ROLES = [
		{ id: 'admin', label: 'Admin' },
		{ id: 'staff', label: 'Staff' },
		{ id: 'member', label: 'Member' }
	];

	const CATEGORIES = [
		{ value: 'amp', label: 'Amplifier' },
		{ value: 'drums', label: 'Drum kit' },
		{ value: 'mic', label: 'Microphone' }
	];
</script>

<!-- Rendered without a `<Form>` around it on purpose: every field here is in
     name-only mode, which is the mode that has to work standalone. The remote
     `field` mode is pinned in FormField.svelte.spec.ts against SvelteKit's own
     field proxy, where a story could only show the same box. -->
{#snippet gallery()}
	<div class="grid max-w-4xl gap-x-6 md:grid-cols-2">
		<FormField name="name" type="text" label="Name" value="Jane Doe" />
		<FormField name="email" type="email" label="Email" value="jane@example.dev" />
		<FormField name="phone" type="tel" label="Phone" value="541-555-0134" />
		<FormField name="capacity" type="number" label="Capacity" value={40} />
		<FormField name="password" type="password" label="Password" value="hunter2" />
		<FormField name="eventDate" type="date" label="Date" value="2026-08-20" />
		<FormField name="startTime" type="time" label="Start time" value="19:30" />
		<FormField name="doorsAt" type="datetime-local" label="Doors" value="2026-08-20T19:00" />
		<FormField
			name="category"
			type="select"
			label="Category"
			options={CATEGORIES}
			value="amp"
			class="md:col-span-2"
		/>
		<FormField
			name="bio"
			type="textarea"
			label="Bio"
			value="Drummer, occasional synth."
			class="md:col-span-2"
		/>
		<FormField
			name="roles"
			type="tags"
			label="Roles"
			options={ROLES}
			value={['staff']}
			class="md:col-span-2"
		/>
		<FormField
			name="coverFees"
			type="checkbox"
			label="Fees"
			checkboxLabel="Cover the processing fee"
		/>
		<FormField name="published" type="toggle" label="Visibility" checkboxLabel="Published" />
	</div>
{/snippet}

<Story name="Gallery" template={gallery} />

<!-- The caption is a `<label for>` for a single control and a `<legend>` for a
     real group. Both are `.fieldset-legend`, so the difference is invisible
     here and lives in the spec — these two are for the a11y addon, which reads
     the association rather than the styling. -->
<Story name="Text" args={{ type: 'text', label: 'Name', value: 'Jane Doe' }} />
<Story
	name="Checkbox with an inline label"
	args={{
		type: 'checkbox',
		label: 'Fees',
		checkboxLabel: 'Cover the processing fee'
	}}
/>

<Story
	name="With a description"
	args={{
		type: 'text',
		label: 'Slug',
		value: 'loud-night',
		description: 'Lowercase letters and dashes. This becomes the public URL.'
	}}
/>

<!-- An issue replaces the description rather than stacking under it: the
     hint has done its job by the time the server disagrees. -->
<Story
	name="With a validation issue"
	args={{
		type: 'email',
		label: 'Email',
		value: 'not-an-address',
		description: 'We only use this for booking confirmations.',
		issues: [{ path: ['email'], message: 'Enter a valid email address.' }]
	}}
/>

<!-- `display` exists because the stored value is rarely the readable one: a
     date is `2026-08-20`, a price is `10.00`. The readonly branch also renders
     no `[name]` input at all, so the field cannot post. -->
<Story
	name="Read-only"
	args={{
		type: 'date',
		label: 'Date',
		readonly: true,
		value: '2026-08-20',
		display: 'August 20, 2026'
	}}
/>
<Story
	name="Read-only long text"
	args={{
		type: 'textarea',
		label: 'Description',
		readonly: true,
		value: 'First line of the notes.\nSecond line, which has to stay on its own line.'
	}}
/>

<Story name="Calendar" args={{ type: 'calendar', label: 'Pick a day', value: '' }} />
