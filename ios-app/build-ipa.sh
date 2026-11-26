#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

release="$(node -p "require('../package.json').version")"
build_number="${GITHUB_RUN_NUMBER:-1}"
output="$PWD/dist"
derived="$output/build"
mkdir -p "$output"

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO MARKETING_VERSION="${release%%-*}" CURRENT_PROJECT_VERSION="$build_number" build

app="$derived/Build/Products/Release-iphoneos/App.app"
executable="$app/$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$app/Info.plist")"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")" = 'io.github.lllliam.spacetimeglobe'
test "$(xcrun lipo -archs "$executable")" = 'arm64'
xcrun vtool -show-build "$executable" | awk '$1 == "platform" && $2 == "IOS" {device=1} END {exit !device}'
test ! -e "$app/embedded.mobileprovision"
cmp ../index.offline.html "$app/public/index.html"
test ! -e "$app/public/sw.js"

stage="$(mktemp -d)"
mkdir "$stage/Payload"
ditto "$app" "$stage/Payload/SpacetimeGlobe.app"
ipa="SpacetimeGlobe-$release-iOS-unsigned.ipa"
ditto -c -k --norsrc --keepParent "$stage/Payload" "$stage/$ipa"
mv -f "$stage/$ipa" "$output/$ipa"
(
  cd "$output"
  unzip -tq "$ipa"
  shasum -a 256 "$ipa" | tee "$ipa.sha256"
)
