<script lang="ts">
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { getUser, updateUser } from '$lib/remote/users.remote';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/shared/Form';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';

	// Everything arrives as a resolved prop. Keeping this component's script
	// fully synchronous is the point of extracting it: a top-level `await` marks
	// every later declaration "blocked", which compiles each
	// `updateFields.X.as()` into an async derived and trips
	// effect_update_depth_exceeded — the same crash /staff/bands/[id] hit before
	// its form was split out (see StaffBandForm.svelte).
	let {
		member,
		roleOptions,
		initialRoles,
		id
	}: {
		member: Awaited<ReturnType<typeof getUser>>;
		roleOptions: { id: string; label: string }[];
		initialRoles: string[];
		id: string;
	} = $props();

	const { fields: updateFields } = updateUser;
</script>

<!--
	The Save button lives in this card's header rather than the page header: the
	page header is now shared by every tab, and a Save that is visible while
	looking at someone's volunteer shifts would be saving a form off-screen.

	Nothing but Fields and the SubmitButton may go inside this <Form>. `Action`
	renders a bare <Button>, which has no `type` and therefore submits — every
	action on this page deliberately sits in a sibling panel.
-->
<Form remote={updateUser} guard successToast="Changes saved">
	<InfoCard title="Account Info">
		{#snippet header(title: string)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				<SubmitButton shortcut="mod+s" variant="primary" size="sm">
					{#snippet icon()}
						<IconDeviceFloppy size={16} />
					{/snippet}
				</SubmitButton>
			</div>
		{/snippet}

		<!-- The mutation target travels as a validated field; `params.id` is
		     caller-controlled for remote calls and must not identify the record. -->
		<input {...updateFields.id.as('hidden', id)} />
		<div class="@container grid grid-cols-4 gap-x-2">
			<Field
				name="name"
				type="text"
				value={member.name}
				class="col-span-4 @md:col-span-2 @lg:col-span-3"
			/>
			<Field
				name="pronouns"
				type="text"
				value={member.pronouns ?? ''}
				class="col-span-4 @md:col-span-2 @lg:col-span-1"
			/>
			<Field
				name="email"
				readonly={true}
				type="email"
				value={member.email}
				class="col-span-4 @md:col-span-2 @lg:col-span-2"
			/>
			<Field
				name="phone"
				type="tel"
				value={member.phone ?? ''}
				class="col-span-4 @md:col-span-2 @lg:col-span-2"
			/>
			<Field
				class="col-span-4"
				name="roles"
				type="tags"
				options={roleOptions}
				multiple={true}
				value={initialRoles}
			/>
		</div>
	</InfoCard>
</Form>
