# App Store Connect scripts

Small helpers over the App Store Connect API for aFinder (Mac App Store, `cz.attosoft.afinder`) and aFinder
Remote (iOS, `com.attosoft.afinder`). They read the API key from
`~/.appstoreconnect/private_keys/AuthKey_<KEY>.p8` (never committed); the key ID and issuer come from `ASC_KEY_ID` and `ASC_ISSUER_ID`
(e.g. exported in `~/.zshrc`).

```bash
node scripts/appstore/asc.cjs GET "/v1/apps"                  # any API call, prints status + JSON
node scripts/appstore/meta.cjs                                # store texts, URLs, categories (en-US, cs)
node scripts/appstore/shots.cjs <versionLocalizationId> APP_DESKTOP <dir-of-png>   # replaces a screenshot set
IDB=<path to idb> node scripts/appstore/phone-shots.cjs <simulator-udid> <out-dir>  # iPhone shots on the demo home
```

Builds:

```bash
npm run dist:mas                                              # dist/mas-universal/aFinder-<version>-mas.pkg
xcrun altool --upload-app -f dist/mas-universal/aFinder-*-mas.pkg -t macos --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

The iOS app (in `mobile/app/ios`, after `expo prebuild`):

```bash
xcodebuild -workspace aFinder.xcworkspace -scheme aFinder -configuration Release -destination generic/platform=iOS \
  -archivePath build/testflight/aFinder.xcarchive -allowProvisioningUpdates DEVELOPMENT_TEAM=5YNN4BF446 archive
xcodebuild -exportArchive -archivePath build/testflight/aFinder.xcarchive -exportPath build/testflight/export \
  -exportOptionsPlist ../../../scripts/appstore/export-ios.plist -allowProvisioningUpdates
```

Cloud
signing breaks on the "á" in the team name, so a local Apple Distribution certificate must be in the keychain.
Provisioning profiles for the Mac build go to `build/aFinder_AppStore.provisionprofile` and
`build/aFinder_Dev.provisionprofile` (git-ignored); recreate them with the API when they expire.
