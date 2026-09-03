#!/usr/bin/env bash
#
# Rebrands the installed browser as CrewSurf.
#
# This runs against the app `install.sh` produced, and `install.sh` calls it at
# the end — so a reinstall re-applies the branding rather than reverting it.
# Everything it touches is gitignored, and it never modifies the upstream disk
# image, so `./install.sh --force` always gets you back to a clean slate.
#
# What it changes: every place macOS shows the product name (Finder, Dock, menu
# bar, About, permission prompts, the ~100 localised string tables) and the icon.
#
# What it deliberately does not change, and why:
#   * The bundle identifier (com.browseros.BrowserClaw) — the user profile and
#     the bundled agent server are keyed to it. Renaming it orphans your logins
#     and buys nothing a user can see.
#   * The framework and helper *file* names — Chromium resolves those paths at
#     build time and burns them into the Mach-O load commands. Renaming them
#     means patching binaries, which breaks far more than it fixes. Their
#     display names are rebranded instead, which is what prompts actually show.
#   * Strings compiled into Chromium's .pak files and the packed agent
#     extensions. Those need a source build — see README.
#
# Modifying the bundle invalidates its notarised signature, so the app is
# re-signed ad-hoc at the end. That is what makes it launch; it also means
# macOS treats it as locally-built software rather than a notarised download.
#
set -euo pipefail

BRAND="CrewSurf"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${1:-$HERE/CrewSurf.app}"
LOGO="$HERE/../Studio/public/logoCS.png"

# `--in-place` says the caller already handed us a scratch copy, so we edit it
# directly and skip the swap. install.sh uses this to brand the app *before* it
# is ever written to its final path — see the App Management note below.
IN_PLACE=0
[[ "${2:-}" == "--in-place" ]] && IN_PLACE=1

if [[ ! -d "$APP" ]]; then
  echo "No app at $APP — run ./install.sh first." >&2
  exit 1
fi

# ---------------------------------------------------------------- staging --
# macOS App Management refuses writes into an app bundle it has registered, and
# registration happens the first time the app is launched. So the branded app is
# assembled somewhere unregistered and the real location is written exactly once.
# Editing the installed app in place works only until its first launch, which is
# why install.sh brands before installing rather than after.
STAGE="$(mktemp -d)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

if (( IN_PLACE )); then
  WORK="$APP"
else
  echo "Quitting ${BRAND} if it is running…"
  osascript -e "tell application id \"com.browseros.BrowserClaw\" to quit" 2>/dev/null || true
  sleep 2
  pkill -9 -f "$APP/Contents/MacOS" 2>/dev/null || true

  echo "Staging a copy…"
  cp -R "$APP" "$STAGE/app.app"
  WORK="$STAGE/app.app"
fi

# ------------------------------------------------------------------ icon --
if [[ -f "$LOGO" ]]; then
  echo "Building the icon…"
  ICONSET="$STAGE/icon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$LOGO" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1
    double=$((size * 2))
    sips -z "$double" "$double" "$LOGO" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICONSET" -o "$STAGE/app.icns"
  # Every .icns in the bundle, so helper alerts carry the mark too.
  find "$WORK" -name "app.icns" -print0 | while IFS= read -r -d '' icns; do
    cp "$STAGE/app.icns" "$icns"
  done
else
  echo "No logo at $LOGO — keeping the existing icon." >&2
fi

# ----------------------------------------------------------------- plists --
echo "Renaming the app…"
plutil -replace CFBundleName        -string "$BRAND" "$WORK/Contents/Info.plist"
plutil -replace CFBundleDisplayName -string "$BRAND" "$WORK/Contents/Info.plist"

# The bundle declares *two* icon sources: CFBundleIconFile (app.icns, which we
# replace above) and CFBundleIconName, which points at an "AppIcon" entry inside
# the compiled Assets.car. macOS prefers the asset catalog, so replacing app.icns
# alone changes nothing — the Dock keeps showing the vendor's mark. Dropping the
# key makes macOS fall back to app.icns. Rebuilding Assets.car would need Xcode's
# actool and risks the bundle's other assets, for no extra benefit.
plutil -remove CFBundleIconName "$WORK/Contents/Info.plist" 2>/dev/null || true

# ------------------------------------------------------------ auto-update --
# The app ships Sparkle, and Sparkle replaces the whole bundle when it updates —
# which silently reverts every change this script makes. That is not theoretical:
# an update to 0.49.5 put the vendor's name and icon back while CrewSurf was
# running, leaving only the profile-side cockpit branded.
#
# Turning it off is therefore load-bearing, not a preference. The cost is real
# and worth stating: this build no longer receives upstream security fixes, so
# re-run ./install.sh --force when you want a newer Chromium.
echo "Disabling Sparkle auto-update…"
plutil -replace SUEnableAutomaticChecks -bool false "$WORK/Contents/Info.plist" 2>/dev/null || \
  plutil -insert SUEnableAutomaticChecks -bool false "$WORK/Contents/Info.plist" 2>/dev/null || true
plutil -replace SUAutomaticallyUpdate -bool false "$WORK/Contents/Info.plist" 2>/dev/null || \
  plutil -insert SUAutomaticallyUpdate -bool false "$WORK/Contents/Info.plist" 2>/dev/null || true

# Helper bundles get display names too — these are what appear in permission
# prompts and in Activity Monitor's readable column.
find "$WORK/Contents/Frameworks" -name "Info.plist" -path "*Helper*" -print0 |
  while IFS= read -r -d '' plist; do
    current="$(plutil -extract CFBundleName raw "$plist" 2>/dev/null || echo "")"
    if [[ -n "$current" ]]; then
      renamed="${current//BrowserOS neo/$BRAND}"
      renamed="${renamed//BrowserOS/$BRAND}"
      plutil -replace CFBundleName -string "$renamed" "$plist" 2>/dev/null || true
      plutil -replace CFBundleDisplayName -string "$renamed" "$plist" 2>/dev/null || true
    fi
  done

# --------------------------------------------------------------- strings --
# InfoPlist.strings are binary plists, one per locale, and they carry the product
# name in the permission prompts ("Once X has access, websites will be able to…").
echo "Rewriting localised strings…"
count=0
while IFS= read -r -d '' strings_file; do
  plutil -convert xml1 "$strings_file" 2>/dev/null || continue
  # LC_ALL=C keeps sed byte-oriented; these files are UTF-8 with many scripts.
  LC_ALL=C sed -i '' \
    -e "s/BrowserOS neo/$BRAND/g" \
    -e "s/BrowserClaw/$BRAND/g" \
    -e "s/BrowserOS/$BRAND/g" \
    "$strings_file"
  plutil -convert binary1 "$strings_file" 2>/dev/null || true
  count=$((count + 1))
done < <(find "$WORK" -name "InfoPlist.strings" -print0)
echo "  $count locale tables updated"

# ------------------------------------------------------------------ paks --
# The menu bar, About box and Settings read from Chromium's .pak tables, so the
# rebrand is only skin-deep without this. See tools/repack_pak.py for the format.
echo "Rewriting Chromium resource strings…"
find "$WORK" -name "*.pak" -print0 |
  xargs -0 python3 "$HERE/tools/repack_pak.py" \
    "BrowserOS neo=$BRAND" "BrowserClaw=$BRAND" "BrowserOS=$BRAND" --

# ------------------------------------------------------------ extensions --
# The agent's own UI — new tab, side panel — ships as signed .crx files, the one
# layer the .pak rewrite cannot see into. The signing key lives in .cache so the
# extension ids stay put across reinstalls; see tools/rebrand_extensions.py.
echo "Rebranding the bundled agent extensions…"
mkdir -p "$HERE/.cache/crx-keys"
python3 "$HERE/tools/rebrand_extensions.py" \
  "$WORK" "$HERE/.cache/crx-keys" "$STAGE/crx" "$LOGO" \
  "BrowserOS neo=$BRAND" "BrowserClaw=$BRAND" "browserclaw=crewsurf" \
  "BrowserOS=$BRAND" "browseros=crewsurf" || echo "  extension rebrand skipped" >&2

# ---------------------------------------------------------------- signing --
# Extended attributes left by the copy make codesign refuse with "resource fork,
# Finder information, or similar detritus not allowed".
echo "Clearing extended attributes…"
xattr -cr "$WORK"

# The version directory name is read rather than assumed — it changes with every
# upstream release and a stale constant here fails silently.
FW="$(find "$WORK/Contents/Frameworks" -maxdepth 1 -name "*.framework" -print -quit)"
echo "Re-signing (ad-hoc)…"
if [[ -n "$FW" && -d "$FW/Versions/Current" ]]; then
  VDIR="$(cd "$FW/Versions/Current" && pwd -P)"
  # Inside out: helpers, then the framework version, then the app. `--deep` is
  # deprecated and gets nested signing subtly wrong, so it is done by hand.
  while IFS= read -r -d '' helper; do
    codesign --force --sign - --timestamp=none "$helper" >/dev/null 2>&1 || true
  done < <(find "$VDIR/Helpers" -maxdepth 1 -name "*.app" -print0 2>/dev/null)
  while IFS= read -r -d '' dylib; do
    codesign --force --sign - --timestamp=none "$dylib" >/dev/null 2>&1 || true
  done < <(find "$VDIR/Libraries" -name "*.dylib" -print0 2>/dev/null)
  codesign --force --sign - --timestamp=none "$VDIR" >/dev/null 2>&1 || true
fi
codesign --force --sign - --timestamp=none "$WORK"

if ! codesign -v "$WORK" 2>/dev/null; then
  echo "Re-signing failed — leaving the installed app untouched." >&2
  exit 1
fi

# ------------------------------------------------------------------ swap --
if (( IN_PLACE )); then
  echo
  echo "Rebranded to ${BRAND} (in place)."
else
  echo "Installing the rebranded app…"
  rm -rf "$APP"
  cp -R "$WORK" "$APP"
  echo
  echo "Rebranded to ${BRAND}."
fi

# LaunchServices caches the old name and icon; without this the Dock keeps
# showing the previous branding until logout.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP" >/dev/null 2>&1 || true
touch "$APP"

# Sparkle consults user defaults ahead of the bundle plist, so the plist edit
# above is not enough on its own.
defaults write com.browseros.BrowserClaw SUEnableAutomaticChecks -bool false 2>/dev/null || true
defaults write com.browseros.BrowserClaw SUAutomaticallyUpdate  -bool false 2>/dev/null || true
defaults write com.browseros.BrowserClaw SUScheduledCheckInterval -int 604800000 2>/dev/null || true

plutil -p "$APP/Contents/Info.plist" | grep -E "CFBundleName|CFBundleDisplayName"
