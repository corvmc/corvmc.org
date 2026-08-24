import type { Preview } from '@storybook/sveltekit';
// Load the app's real global stylesheet so daisyUI themes, brand `--cmc-*`
// tokens, and the @plugin/utility layers apply inside Storybook. Without this,
// components render unstyled.
import '../src/routes/layout.css';
import TooltipProvider from './TooltipProvider.svelte';
import EntityViewerDecorator from './EntityViewerDecorator.svelte';

// Toolbar control to flip between the two daisyUI themes defined in layout.css.
export const globalTypes = {
	theme: {
		description: 'daisyUI theme',
		defaultValue: 'corvmc',
		toolbar: {
			title: 'Theme',
			icon: 'paintbrush',
			items: [
				{ value: 'corvmc', title: 'Light' },
				{ value: 'corvmc-dark', title: 'Dark' }
			],
			dynamicTitle: true
		}
	},
	// Entity chips/rows/cards derive their own hrefs from who is looking and
	// which panel they are in. Crossing these two toolbars is how you check the
	// rule that motivated the design: a staff user who is also in a band gets
	// `/band/[slug]` inside that band's panel, and `/staff/bands/[id]` in the
	// staff panel.
	entityViewer: {
		description: 'Who is looking',
		defaultValue: 'staff',
		toolbar: {
			title: 'Viewer',
			icon: 'user',
			items: ['anonymous', 'member', 'band-member', 'staff', 'staff-and-band-member'],
			dynamicTitle: true
		}
	},
	entityPanel: {
		description: 'Which panel is being rendered',
		defaultValue: 'staff',
		toolbar: {
			title: 'Panel',
			icon: 'browser',
			items: ['public', 'member', 'band', 'staff'],
			dynamicTitle: true
		}
	}
};

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i
			}
		},

		a11y: {
			// 'todo' - show a11y violations in the test UI only
			// 'error' - fail CI on a11y violations
			// 'off' - skip a11y checks entirely
			//
			// Was 'todo', which ran a full axe scan on every story during `vitest
			// --project=storybook` while never being able to fail: the addon's
			// afterEach scans whenever test !== 'off', but its
			// expect(...).toHaveNoViolations() only asserts when the mode is
			// 'error'. That cost 4.5s of the project's 6s of test time for a
			// result nothing consumed. Flip to 'error' to actually gate on it.
			test: 'off'
		}
	},
	decorators: [
		// The app mounts one `Tooltip.Provider` at the root layout; stories render
		// outside it, and bits-ui's `Tooltip.Root` throws without one.
		() => ({ Component: TooltipProvider, props: {} }),
		(story, context) => ({
			Component: EntityViewerDecorator,
			props: {
				viewer: (context.globals.entityViewer as string) ?? 'staff',
				panel: (context.globals.entityPanel as string) ?? 'staff'
			}
		}),
		// Apply the selected theme to the document and paint the canvas with the
		// theme's base surface so dark mode is actually visible.
		(story, context) => {
			const theme = (context.globals.theme as string) ?? 'corvmc';
			if (typeof document !== 'undefined') {
				document.documentElement.setAttribute('data-theme', theme);
				document.body.style.background = 'var(--color-base-100)';
				document.body.style.color = 'var(--color-base-content)';
			}
			return story();
		}
	]
};

export default preview;
