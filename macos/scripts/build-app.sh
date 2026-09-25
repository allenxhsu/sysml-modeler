#!/bin/sh
# Build "SysML Modeler.app" from the Swift package and the web app beside it.
#
#   macos/scripts/build-app.sh            # release build into macos/build/
#   CONFIG=debug macos/scripts/build-app.sh
#
# NSDocument takes the document types it can open from Info.plist, so the app
# must run as a bundle: the bare executable cannot open or save models.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$PKG/.." && pwd)"
CONFIG="${CONFIG:-release}"
OUT="${OUT_DIR:-$PKG/build}"
APP="$OUT/SysML Modeler.app"
VERSION="${VERSION:-1.0}"

# The vendored kit copies must match their sources before they are bundled.
# A kit that does not exist yet (or has no copy script yet) is skipped, not failed.
check_copy() {  # <kit dir> <copy-script args…>
  kit="$REPO/../$1"; shift
  if [ -f "$kit/scripts/copy-into.mjs" ]; then
    (cd "$REPO" && node "$kit/scripts/copy-into.mjs" --check "$@") || { echo "refresh the $kit copy first"; exit 1; }
  else
    echo "skipped: $kit has no scripts/copy-into.mjs yet"
  fi
}
check_copy ui-kit ui-kit
check_copy shell-kit src/host.js
[ -d "$REPO/sync-kit" ] && check_copy sync-kit sync-kit
# Pairing ends in a sysml://connect?… link that Launch Services delivers only to a bundle claiming the scheme.
URL_TYPES="$(node "$REPO/../shell-kit/scripts/url-types.mjs" sysml 'SysML Modeler')"

swift build --package-path "$PKG" -c "$CONFIG" --product SysMLModeler
BIN_DIR="$(swift build --package-path "$PKG" -c "$CONFIG" --show-bin-path)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$BIN_DIR/SysMLModeler" "$APP/Contents/MacOS/SysML Modeler"

# The web app, exactly as the browser gets it. Only what the page loads:
# the kit's build scripts, Swift theme and template stay behind.
WEB="$APP/Contents/Resources/web"
cp "$REPO/index.html" "$WEB/"
cp -R "$REPO/src" "$WEB/src"
mkdir -p "$WEB/ui-kit"
for part in css js fonts; do cp -R "$REPO/ui-kit/$part" "$WEB/ui-kit/$part"; done
mkdir -p "$WEB/sync-kit" && cp -R "$REPO/sync-kit/js" "$WEB/sync-kit/js"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>SysML Modeler</string>
  <key>CFBundleDisplayName</key><string>SysML Modeler</string>
  <key>CFBundleIdentifier</key><string>org.sysml.modeler</string>
  <key>CFBundleExecutable</key><string>SysML Modeler</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <!-- A model file is plain JSON, as the web app writes it. Alternate
           rank: the app opens JSON when asked, but never claims all of it. -->
      <key>CFBundleTypeName</key><string>SysML Model</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key><array><string>public.json</string></array>
      <key>NSDocumentClass</key><string>SysMLModeler.ModelDocument</string>
    </dict>
    <dict>
      <!-- XMI opens as a new, untitled model; it is never written back over. -->
      <key>CFBundleTypeName</key><string>XMI Model Interchange</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key><array><string>org.omg.xmi</string><string>public.xml</string></array>
      <key>NSDocumentClass</key><string>SysMLModeler.ModelDocument</string>
    </dict>
  </array>
  <key>UTImportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key><string>org.omg.xmi</string>
      <key>UTTypeDescription</key><string>XMI Model Interchange</string>
      <key>UTTypeConformsTo</key><array><string>public.xml</string></array>
      <key>UTTypeTagSpecification</key>
      <dict><key>public.filename-extension</key><array><string>xmi</string><string>uml</string></array></dict>
    </dict>
  </array>
$URL_TYPES
</dict>
</plist>
PLIST
node "$REPO/../shell-kit/scripts/url-types.mjs" --check "$APP/Contents/Info.plist" sysml

# An ad-hoc signature, so macOS will launch a locally built bundle.
codesign --force --sign - "$APP" >/dev/null
echo "$APP"
