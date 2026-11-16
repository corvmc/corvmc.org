import rule from './no-unqualified-correlation.js';
import { tsRuleTester } from './rule-tester.js';

tsRuleTester().run('no-unqualified-correlation', rule as never, {
	valid: [
		{
			code: 'db.select({ n: sql`${sql`(select count(*) from ${child} where ${child.parentId} = ${parent.id})`}` }).from(parent);'
		},
		{
			code: 'db.select({ n: sql`(select count(*) from ${child} where ${child.parentId} = ${id})` }).from(parent);'
		},
		{
			code: 'db.select().from(parent).where(sql`exists (select 1 from ${child} where ${child.parentId} = ${parent.id})`);'
		},
		{ code: 'db.select({ total: sql`sum(${parent.amount})` }).from(parent);' },
		{
			code: 'db.select({ n: sql`(select count(*) from ${child} where ${child.parentId} = ${parent.id})` }).from(parent).leftJoin(other, eq(other.id, parent.otherId));'
		}
	],
	invalid: [
		{
			code: 'db.select({ n: sql`(select count(*) from ${child} where ${child.parentId} = ${parent.id})` }).from(parent);',
			errors: [{ messageId: 'unqualified' }]
		},
		{
			code: 'db.select({ n: sql`exists (select 1 from ${child} c join ${other} o on 1 where c.x = ${parent.id})` }).from(parent);',
			errors: [{ messageId: 'unqualified' }]
		}
	]
});
