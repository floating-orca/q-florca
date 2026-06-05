#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

setup() {
  temp_dir=$(mktemp -d)
  cp -r "$BATS_TEST_DIRNAME"/* "$temp_dir"
  echo "/increment/" > "$temp_dir/.florcaignore"
}

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$temp_dir" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" -e "example" --input "4" --wait
  assert_output --partial 'Output: [1,3,5,7]'
}

teardown() {
  florca delete "$DEPLOYMENT" || true
  rm -rf "$temp_dir"
}
