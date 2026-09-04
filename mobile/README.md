# Fair Share mobile

Expo app for iOS and Android. It talks to the same Netlify API as the website. There is no ejected `ios/` or `android/` folder — store binaries are built with EAS.

## Develop

```bash
cd mobile
npm ci
cp .env.example .env   # optional
npx expo start
```

Open in Expo Go, an emulator, or press `w` for a web preview. Point the app at local Netlify with:

```bash
EXPO_PUBLIC_FAIRSHARE_API=http://localhost:8888 npx expo start
```

On a physical phone, use your computer's LAN IP instead of `localhost`.

```bash
npm test
npm run typecheck
```

## Donate link (optional, no in-app payments)

The home screen can show **Support Fair Share**. It opens an `https` URL in the system browser. There is no StoreKit, Stripe, or in-app purchase.

Set `EXPO_PUBLIC_DONATE_URL` or `expo.extra.donateUrl` in `app.json`. Leave them empty to hide the button (recommended for a first App Store review if you are donating to yourself rather than a registered nonprofit).

## Store builds (EAS, no eject)

Do **not** run `npx expo prebuild` or commit `ios/` / `android/`. EAS generates native projects in the cloud.

1. Create an Expo account and run `npx eas-cli login` then `npx eas-cli init` from `mobile/` (this writes `extra.eas.projectId` into `app.json` — commit that).
2. Preview APK: `npx eas-cli build --profile preview --platform android`
3. Production: `npx eas-cli build --profile production --platform ios` (and android)
4. Submit when you have App Store Connect / Play Console accounts: `npx eas-cli submit` — credentials stay in EAS, not this repo.

Bundle ID / package: `app.fairshare.trips`. Change it before the first store listing if you want a different identifier.

Submission still needs screenshots, a privacy policy URL, and a support URL. Play Data Safety: photos are uploaded to our server, no accounts, no ads, no tracking.
