#!/bin/bash
# Quick rebuild and install Meetily to /Applications
# Usage: ./rebuild_install.sh
# This is faster than clean_build.sh because it reuses the existing target directory.

set -e

export RUST_LOG=${RUST_LOG:-info}

echo "==> Installing pnpm dependencies..."
pnpm install --prefer-offline 2>/dev/null

echo "==> Building Next.js..."
pnpm run build

echo "==> Building Tauri release..."
# The signing key warning is non-fatal; the app bundle is still produced
pnpm run tauri build 2>&1 || true

APP_BUNDLE="$(dirname "$0")/../target/release/bundle/macos/meetily.app"
if [ ! -d "$APP_BUNDLE" ]; then
    echo "ERROR: Build failed - no app bundle found at $APP_BUNDLE"
    exit 1
fi

echo "==> Installing to /Applications..."
# Kill running instance if any
pkill -f "Meetily.app/Contents/MacOS/meetily" 2>/dev/null || true
sleep 1
cp -R "$APP_BUNDLE" /Applications/Meetily.app

echo "==> Done! Meetily installed to /Applications/Meetily.app"
echo "    Open it from Spotlight or Finder."
