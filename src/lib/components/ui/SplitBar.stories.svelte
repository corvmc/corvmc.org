<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SplitBar from './SplitBar.svelte';

	const { Story } = defineMeta({
		title: 'Shared/SplitBar',
		component: SplitBar,
		tags: ['autodocs'],
		parameters: {
			docs: {
				description: {
					component:
						'One total, divided between two parties, with a third fixed slice — card ' +
						'processing — taken off the top and not draggable. Humble Bundle’s slider, ' +
						'in the shape this app needs: showing a buyer where their money goes ' +
						'reframes the question from *what do I owe* to *what do they get*, and a ' +
						'cut you can refuse is an ask rather than a rake. Domain-free by ' +
						'construction — it knows a total, two movable shares and a locked ' +
						'remainder, and nothing about music, tickets or Stripe. Pointer drag is ' +
						'the affordance, not the mechanism: the divider is a real `role="slider"` ' +
						'with arrow-key support, and the “Adjust exactly” number input below is a ' +
						'complete alternative path.'
				}
			}
		}
	});
</script>

<script lang="ts">
	// `value` + `onchange` rather than `$bindable`, because real callers hold this
	// as a `$derived` that falls back to a suggestion until the user touches it —
	// and a derived cannot be bound to. The stories hold plain state instead.
	let atSuggested = $state(282);
	let atZero = $state(0);
	let atMax = $state(1426);
	let noFee = $state(450);
	let longNames = $state(600);
</script>

<!-- The default position: $15.00, 74¢ to the card, 30% of what is left to divide. -->
<Story name="Default">
	<div class="max-w-lg">
		<SplitBar
			totalCents={1500}
			value={atSuggested}
			onchange={(c) => (atSuggested = c)}
			fixedCents={74}
			fixedLabel="Card processing"
			valueLabel="The collective"
			otherLabel="Sun Atoms"
		/>
	</div>
</Story>

<!-- Refused entirely. The whole net goes to the other party and the collective's
     segment disappears — the position that has to look deliberate, not broken. -->
<Story name="Dragged to zero">
	<div class="max-w-lg">
		<SplitBar
			totalCents={1500}
			value={atZero}
			onchange={(c) => (atZero = c)}
			fixedCents={74}
			fixedLabel="Card processing"
			valueLabel="The collective"
			otherLabel="Sun Atoms"
		/>
	</div>
</Story>

<!-- The other end: everything divisible allocated, the other party at $0.00. -->
<Story name="Dragged to the maximum">
	<div class="max-w-lg">
		<SplitBar
			totalCents={1500}
			value={atMax}
			onchange={(c) => (atMax = c)}
			fixedCents={74}
			fixedLabel="Card processing"
			valueLabel="The collective"
			otherLabel="Sun Atoms"
		/>
	</div>
</Story>

<!-- No fixed slice: the plain two-party case, for a payment that isn't on a card. -->
<Story name="No fixed slice">
	<div class="max-w-lg">
		<SplitBar
			totalCents={1500}
			value={noFee}
			onchange={(c) => (noFee = c)}
			valueLabel="The collective"
			otherLabel="Sun Atoms"
		/>
	</div>
</Story>

<!-- `otherLabel` is real user data — a band picked its own name, and a bill can
     carry a long one. The segment labels have to survive it at every width. -->
<Story name="Long party names">
	<div class="max-w-lg">
		<SplitBar
			totalCents={2000}
			value={longNames}
			onchange={(c) => (longNames = c)}
			fixedCents={88}
			fixedLabel="Card processing"
			valueLabel="Corvallis Music Collective"
			otherLabel="The Reluctant Astronauts & Friends"
		/>
	</div>
</Story>

<!-- A free ticket or a name-your-price release taken to zero. Nothing to divide,
     so the control must render inert rather than divide by zero. -->
<Story name="Zero total">
	<div class="max-w-lg">
		<SplitBar
			totalCents={0}
			value={0}
			onchange={() => {}}
			fixedLabel="Card processing"
			valueLabel="The collective"
			otherLabel="Sun Atoms"
		/>
	</div>
</Story>
