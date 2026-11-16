# Teacher directory

Status: ✅ /directory/instructors

Public and unauthenticated — the person looking for a teacher is not a member. A sibling route rather than a tab on `/directory`, because the reader, the columns and the truth all differ: the existing `teachesLessons` flag is self-declared and still means "anywhere", now labelled **Teaches privately** to keep the two apart. Three gates decide who appears: an active grant (an unapproved application is a real draft listing one predicate from the public page), `directory_entry.visibility`, and `contactForView` over the **resolved** contact — so a members-only contact is withheld rather than published through the teaching-contact fallback
