#!/bin/zsh
# Wraps the built binary in a minimal .app bundle so macOS gives it its own
# identity in Privacy & Security -> Accessibility (instead of attributing the
# permission to the terminal that launched it). Ad-hoc signed; local use only.
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release

APP=build/LocalAutocorrect.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/LocalAutocorrectD "$APP/Contents/MacOS/LocalAutocorrect"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>LocalAutocorrect</string>
    <key>CFBundleIdentifier</key><string>dev.jordanmmck.local-autocorrect</string>
    <key>CFBundleName</key><string>Local Autocorrect</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP"
echo "Built $APP — launch with: open $APP"
