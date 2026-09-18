import rule from './stable-created-at-order.js';
import { tsRuleTester } from './rule-tester.js';

const tester = tsRuleTester();

tester.run('stable-created-at-order', rule as never, {
	valid: [
		// A unique key after it is the whole fix.
		'db.select().orderBy(asc(t.createdAt), asc(t.id));',
		'db.select().orderBy(desc(t.createdAt), desc(t.id));',
		// created_at earlier in the list is fine — something unique follows.
		'db.select().orderBy(desc(t.createdAt), t.name, asc(t.id));',
		// Nothing to do with created_at.
		'db.select().orderBy(asc(t.name));',
		'db.select().orderBy(desc(t.startsAt), desc(t.id));',
		// Not a query builder at all.
		'thing.orderBy();'
	],
	invalid: [
		{
			code: 'db.select().orderBy(asc(t.createdAt));',
			output: 'db.select().orderBy(asc(t.createdAt), asc(t.id));',
			errors: [{ messageId: 'unstable' }]
		},
		{
			code: 'db.select().orderBy(desc(t.createdAt));',
			output: 'db.select().orderBy(desc(t.createdAt), desc(t.id));',
			errors: [{ messageId: 'unstable' }]
		},
		{
			// A bare column, which drizzle reads as ascending.
			code: 'db.select().orderBy(t.createdAt);',
			output: 'db.select().orderBy(t.createdAt, asc(t.id));',
			errors: [{ messageId: 'unstable' }]
		},
		{
			// The last key is the one that decides; an earlier tiebreaker is not one.
			code: 'db.select().orderBy(asc(t.id), desc(t.createdAt));',
			output: 'db.select().orderBy(asc(t.id), desc(t.createdAt), desc(t.id));',
			errors: [{ messageId: 'unstable' }]
		}
	]
});
