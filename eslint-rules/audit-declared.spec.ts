import rule from './audit-declared.js';
import { tsRuleTester } from './rule-tester.js';

tsRuleTester().run('audit-declared', rule as never, {
	valid: [
		// Declared, three ways.
		{
			code: "export const deleteVenue = form(s, writesAudit('venue.deleted', async (d) => { await requireCapability('venue.manage'); }));"
		},
		{
			code: "export const removeTag = form(s, unaudited('A tag, not a record.', async (d) => { await requireCapability('inbox.manage'); }));"
		},
		{
			code: "export const deleteClosure = form(s, audited({ guard: () => requireCapability('x'), action: 'closure.deleted' }, async () => {}));"
		},
		// A member removing their own thing asks no capability.
		{ code: 'export const removeMyRsvp = command(s, async (d) => { await requireUser(); });' },
		// Staff, but none of the audited classes.
		{
			code: "export const renameVenue = form(s, async (d) => { await requireCapability('venue.manage'); });"
		},
		// A query is not a change.
		{
			code: "export const deleteCount = query(s, async (d) => { await requireCapability('venue.manage'); });"
		}
	],
	invalid: [
		{
			code: "export const deleteVenue = form(s, async (d) => { await requireCapability('venue.manage'); });",
			errors: [{ messageId: 'undeclared' }]
		},
		{
			code: "export const saveFees = form(s, async (d) => { await requireCapability('settings.update'); });",
			errors: [{ messageId: 'undeclared' }]
		},
		{
			code: "export const hide = command(s, async (d) => { await requireCapability('event.manage'); return d.visibility; });",
			errors: [{ messageId: 'undeclared' }]
		},
		{
			code: "export const adjust = command(s, async function (d) { if (!(await can('credit.adjust'))) return; await requireCapability('credit.adjust'); });",
			errors: [{ messageId: 'undeclared' }]
		}
	]
});
