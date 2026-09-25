# The door app

The Tap to Pay door phone (#612) runs a Capacitor shell, `door-app/`, which loads
`https://corvmc.org/member/volunteer/door` in a webview. The phone's own NFC is the card reader. Everything
the staffer sees is the web app, so a fix to the door screen is a deploy, not a reinstall. The
native binary changes only when Capacitor or the Stripe Terminal SDK does.

The design and its reasons are in [`docs/specs/tap-to-pay-spec.md`](../specs/tap-to-pay-spec.md).
The owner's one-time setup (Stripe Location, secrets, webhook event) is its
[Owner setup](../specs/tap-to-pay-spec.md#owner-setup) section.

## What is in `door-app/`

| Path                    | What it is                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `package.json`          | The shell's own dependencies: Capacitor 8.5 and `@capgo/capacitor-stripe-terminal` 8.0.4                                  |
| `capacitor.config.json` | `server.url` is the door screen. JSON, not TS, so the web app's type-check never sees it                                  |
| `www/index.html`        | Required by Capacitor. Shown only if corvmc.org cannot be reached                                                         |
| `android/`              | The generated Android project. `minSdkVersion` is 33 and the Stripe Terminal SDK is pinned to 5.6.0 in `variables.gradle` |

It is **not** part of the web app's workspace, so the root `pnpm install` does not install it and
CI never builds it. Install it on its own, with `--ignore-workspace`.

## Building

You need JDK 21 and the Android SDK (Android Studio installs both).

```bash
cd door-app
pnpm install --ignore-workspace
pnpm build:debug        # cap sync android, then ./gradlew assembleDebug
```

The APK lands at `door-app/android/app/build/outputs/apk/debug/app-debug.apk`, about 80 MB.

To point a build at a preview deployment instead of production, change `server.url` in
`capacitor.config.json` and rebuild. Do not commit that change.

## Installing on the phone

**Installing a build and taking money are mutually exclusive.** `adb install` needs Developer
options; Stripe refuses to connect the reader while they are on. So every install is this whole
procedure:

1. On the phone: Settings, About phone, tap Build number seven times. Then turn on USB debugging
   in Developer options.
2. Plug it in, accept the fingerprint prompt, and run `pnpm install:phone` from `door-app/`.
3. **Turn Developer options off.** Reboot.
4. Open CMC Door, sign in to corvmc.org with a staff account, and allow location and nearby
   devices when asked. The Terminal SDK needs location.
5. Before the doors open, take one test payment: on a test-mode deployment the reader is simulated
   and needs no card. On production, tap a real card for the minimum and refund it from the
   Stripe Dashboard.

Never screenshot or screen-record on the door phone, and leave accessibility services and overlay
apps off. Any of them makes Stripe refuse PIN entry, which fails only the large payments. The door
screen names this problem when it happens.

## What CI covers, and what it cannot

CI covers everything up to the phone: the gateway port and the fake, the connection-token guard,
the door sale's pricing, minting, webhook and ledger, and the web bridge in `src/lib/door/`. The
Terminal SDK does not run on emulators, not even against a simulated reader, so everything from
`connectReader` onward is manual, on the handset, every time.
