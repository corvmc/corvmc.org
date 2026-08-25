<script lang="ts">
	const faqs = [
		{
			question: 'How do free practice hours work?',
			answer:
				"For every $5 you contribute, you get one free hour each month. They show up automatically when your billing cycle renews and refresh monthly. Heads up — unused hours don't roll over, so use them while you've got them."
		},
		{
			question: 'Can I change my contribution amount?',
			answer:
				'Anytime. Adjust it right here on this page. The new amount kicks in at your next billing cycle, and your hours adjust to match.'
		},
		{
			question: 'What happens if I cancel?',
			answer:
				"Nothing dramatic. You keep all your benefits until the end of your current billing period. After that, you're still a member — you just book practice space at the standard rate. And you can always come back."
		},
		{
			question: 'Can I use my hours for band rehearsals?',
			answer:
				"That's the idea. Solo practice, band rehearsals, recording sessions — if you're the one making the reservation, your hours are good for it."
		},
		{
			question: 'What are recurring reservations?',
			answer:
				'A sustaining member perk. Set up a weekly reservation and the same slot books automatically. Especially handy if your band has a regular practice night.'
		},
		{
			question: 'How do equipment credits work?',
			answer:
				'They match your contribution dollar for dollar — $25/month gets you $25 in equipment credits. Use them on premium gear rentals. The smaller stuff (cables, stands, mic clips) is free for all sustaining members.'
		}
	];
</script>

<div>
	<div class="mb-6 text-center">
		<h2 class="text-3xl font-bold">Frequently Asked Questions</h2>
	</div>

	<div class="mx-auto max-w-3xl space-y-2">
		{#each faqs as faq (faq.question)}
			<div class="collapse-arrow collapse bg-base-100">
				<input type="checkbox" />
				<div class="collapse-title font-semibold">{faq.question}</div>
				<div class="collapse-content">
					<p class="opacity-70">{faq.answer}</p>
				</div>
			</div>
		{/each}
	</div>
</div>
