# TorchLit Games — Website

Official site for TorchLit Games. Static site hosted on Firebase Hosting at [torchlitgames.com](https://torchlitgames.com).

## Local dev

```bash
npm run serve   # local preview
npm run deploy  # manual deploy to Firebase
```

## Auto-deploy

Every push to `main` deploys automatically to Firebase Hosting via GitHub Actions.
Requires `FIREBASE_SERVICE_ACCOUNT_TORCHLIT_GAMES` secret set in repo settings.

## Structure

```
public/         # deployed files
  index.html    # main page
  health.json   # internal status
firebase.json   # hosting config
.firebaserc     # project alias
```
