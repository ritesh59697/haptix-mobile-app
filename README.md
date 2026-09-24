# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Building the Android app

`android/` and `ios/` are gitignored, so every EAS build regenerates them from
`app.json`. Run a build with:

```bash
npx eas-cli build -p android --profile preview
```

`preview` produces a standalone APK (the Hermes engine, no dev client), which is the
build to judge startup time and animation smoothness on. `development` produces a dev
client for debugging. Both read their configuration from EAS environment variables,
not from the gitignored `.env`, so a variable that exists only locally is invisible to
a cloud build. The three that matter:

| Variable                            | Effect when missing                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL` | Falls back to the public endpoint, which rate limits a cold launch into HTTP 429 |
| `EXPO_PUBLIC_HAPTIX_DEV_MODE`       | Faucet and fee sponsorship are disabled                                          |
| `EXPO_PUBLIC_HAPTIX_FUNDER_KEY`     | The faucet has no key to pay from                                                |

They live in the `preview` and `development` environments on EAS, and each build
profile names the environment it uses. Push a changed `.env` with:

```bash
npx eas-cli env:push preview --path .env
```

Anything in a client bundle is recoverable from the binary, so the funder key is a
Devnet demo value only. `production` is deliberately left empty: enabling dev mode
there is how a shipped build leaks a key.

Hardware passkeys additionally need the signing certificate published in
`assetlinks.json`. See [PASSKEY_SETUP.md](./PASSKEY_SETUP.md), which records the
fingerprint currently registered.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
