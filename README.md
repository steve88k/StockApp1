# stock-ui-android-studio-ts

React Native CLI + TypeScript starter for Android Studio workflow, paired with a local Express + TypeScript backend.

## What this package includes
- Mobile app code organized for React Native CLI
- TypeScript config for frontend and backend
- Android emulator API config using `10.0.2.2`
- Local backend with mock prediction endpoint
- Project structure ready for future TFLite integration

## Important note
This package contains the application code and configuration, but not the generated native `android/` and `ios/` folders from a full React Native CLI initialization.
To run it directly in Android Studio, first create a real React Native CLI project, then copy the `mobile/` contents into it.

## Recommended setup
1. Create a React Native CLI project:
   ```bash
   npx react-native init StockUIStarter
   ```
2. Copy files from `mobile/` into the generated project root.
3. Run frontend:
   ```bash
   npm install
   npm start
   npm run android
   ```
4. Run backend:
   ```bash
   cd backend
   npm install
   npm run dev
   ```

## Android emulator backend URL
The frontend is configured to use:
- `http://10.0.2.2:8787`

This works for the Android Studio emulator because `10.0.2.2` maps to the host machine.
