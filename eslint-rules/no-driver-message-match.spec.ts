import rule from './no-driver-message-match.js';
import { tsRuleTester } from './rule-tester.js';

tsRuleTester().run('no-driver-message-match', rule as never, {
	valid: [
		{ code: 'if (isUniqueConstraintError(err)) throw new TakenError();' },
		{ code: 'if (!/not found|could not be found/i.test(error.message)) throw error;' },
		{ code: "const label = 'Unique name';" },
		{ code: "message.includes('timeout');" }
	],
	invalid: [
		{
			code: 'if (/UNIQUE constraint failed/i.test(err.message)) f();',
			errors: [{ messageId: 'driverText' }]
		},
		{
			code: 'if (/FOREIGN KEY|constraint/i.test(err.message)) throw new LinkedError();',
			errors: [{ messageId: 'driverText' }]
		},
		{
			code: "if (String(err).includes('SQLITE_CONSTRAINT')) f();",
			errors: [{ messageId: 'driverText' }]
		},
		{
			code: "if (new RegExp('D1_ERROR').test(err.message)) f();",
			errors: [{ messageId: 'driverText' }]
		}
	]
});
