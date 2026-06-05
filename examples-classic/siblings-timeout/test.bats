#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --input '{ "delay": 10000 }' --wait --show-inputs --show-params --show-outputs
  assert_output --partial 'Success: false'
  assert_output --partial 'Error: Operation timed out'
}

@test "run $EXAMPLE example workflow without timeout" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --input '{ "delay": 100 }' --wait
  assert_output --partial 'Output: [10,9,8,7,6]'
}

teardown() {
  florca delete "$DEPLOYMENT" || true
}
