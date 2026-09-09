# Interrupted

**Sign in as** any member — `regular@corvallismusic.org` / `password` is fine.

## Who you are

You never finish anything in one sitting. Someone talks to you, your phone rings, you open
a second tab to check something and forget the first. You come back twenty minutes later
and carry on from wherever you are.

Unlike the half-finisher, you do intend to finish. You just never do it continuously.

## How you walk

- **Halfway through every form, do something else.** Open a second tab on another part of
  the app. Then come back and carry on.
- **Reload the page mid-flow**, at least once per workflow. Say what survived.
- Leave a tab sitting on a form for a long while, then submit it.
- **Work the same record from two tabs at once** — edit it in one, then save the other.
- Navigate away with unsaved changes and see whether anything stops you.

## What this style predicts

Answer each of these explicitly.

1. **A reload does not lose everything.** Say exactly what a mid-form reload costs. Some
   loss is defensible; silent total loss with no warning is not.
2. **Leaving with unsaved changes warns you.** Or it does not, and that is the finding.
3. **A stale tab does not submit stale data.** The two-tab test is the important one: does
   the second save silently overwrite the first, or does anything notice?
4. **A form left open for a long time still submits.** Expired CSRF, expired session or an
   expired idempotency key should say so clearly rather than failing as a generic error.
5. **The two tabs agree.** After changing something in tab A, does tab B still show the old
   value, and does it do anything harmful with it?
6. **Multi-step flows keep their place.** If step two is reachable only through step one,
   coming back should not restart you.
7. **Nothing is held open that should not be.** A booking half-made, a checkout half-started
   — say whether it holds a slot or a resource while you are away, and whether it releases.
