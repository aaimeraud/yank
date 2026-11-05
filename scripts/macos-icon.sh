#!/bin/sh
# Compile src-tauri/icons/yank.icon (an Icon Composer document) into the
# asset catalog macOS reads for the app icon. The catalog carries the light,
# dark and tinted appearances, so the Dock icon follows the system theme;
# icon.icns stays in the bundle as the fallback for older systems.
#
# Runs as Tauri's beforeBundleCommand. Output is a build product under
# src-tauri/target, never committed. Needs Xcode 26 or later (actool reads
# .icon documents from that version on).
set -eu
cd "$(dirname "$0")/.."
out=src-tauri/target/icon
mkdir -p "$out"
xcrun actool src-tauri/icons/yank.icon \
  --compile "$out" \
  --platform macosx \
  --minimum-deployment-target 11.0 \
  --app-icon yank \
  --output-partial-info-plist "$out/partial.plist" >/dev/null
test -s "$out/Assets.car" || { echo "actool produced no Assets.car" >&2; exit 1; }
echo "macOS icon: $out/Assets.car"
