<!--
	The faces the band-site themes are built around. Declared in five
	`font-family` rules and loaded by nobody, so `metal` rendered in Impact and
	`electronic` in whatever generic monospace the machine had (#914).

	Mounted by the public band site and by the page editor's live preview rather
	than in `app.html`: a band's audience should pay for these, the rest of the
	app should not. `indie` is not here — its Inter is close enough to `system-ui`
	that a request for it buys nothing.
-->
<svelte:head>
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Lora:wght@400;600&family=Oswald:wght@400;600&family=Playfair+Display:wght@600;700&display=swap"
	/>
</svelte:head>
