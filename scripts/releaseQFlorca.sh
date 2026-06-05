#!/bin/bash

# Release ONLY the qFLORCA book — no container images, no CLI binary.
#
# qFLORCA (version 0.9.0+Q) ships no pre-built artifacts: users build from source.
# This script just builds the mdBook and publishes it as a GitHub release asset.
#
# Requirements:
#   - mdBook  (https://rust-lang.github.io/mdBook/guide/installation.html)
#   - gh      (https://cli.github.com/), authenticated via `gh auth login`
#
# Overridable via environment:
#   REPO=owner/name   target GitHub repository (default: floating-orca/florca)
#   TAG=v...          release tag (default: v<version>)

set -Eeuo pipefail

version="0.9.0+Q"
repo="${REPO:-floating-orca/florca}"
tag="${TAG:-v${version}}"

# Run from the repository root regardless of where the script is invoked.
DIR="$(dirname "$(realpath "$0")")"
cd "$DIR/.."

command -v mdbook >/dev/null || { echo "error: mdbook not found on PATH" >&2; exit 1; }
command -v gh >/dev/null || { echo "error: gh (GitHub CLI) not found on PATH" >&2; exit 1; }

book_asset="florca-${version}-book.tar.gz"

echo "Building book ..."
mdbook build book

echo "Packaging ${book_asset} ..."
rm -rf dist/qflorca-book
mkdir -p dist/qflorca-book
cp -r book/book dist/qflorca-book/book
tar -czf "dist/${book_asset}" -C dist/qflorca-book book

read -rp "Publish ${book_asset} to ${repo} as release ${tag}? [Enter to continue, Ctrl-C to abort] "

if gh release view "${tag}" --repo "${repo}" >/dev/null 2>&1; then
  echo "Release ${tag} exists — uploading book asset ..."
  gh release upload "${tag}" "dist/${book_asset}" --repo "${repo}" --clobber
else
  echo "Creating release ${tag} ..."
  gh release create "${tag}" "dist/${book_asset}" --repo "${repo}" \
    --title "${tag} (qFLORCA book)" \
    --notes "qFLORCA documentation only. No pre-built images or binaries are published for this version — build from source (see the qFLORCA chapter)."
fi

echo "Done. Book asset: dist/${book_asset}"
