#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --wait --input 5
  assert_output --partial 'Output: 10'
}

@test "run $EXAMPLE example workflow with startChild entry-point" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" -e "startChild" --wait --input 5
  assert_output --partial 'Output: 10'
}

teardown() {
  florca delete "$DEPLOYMENT" || true
}
