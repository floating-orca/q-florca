#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --wait
  assert_output --partial 'Output: {"message":"    Hello, World!"}'
}

@test "run $EXAMPLE example workflow with custom indent" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --input '2' --wait
  assert_output --partial 'Output: {"message":"  Hello, World!"}'
}

teardown() {
  florca delete "$DEPLOYMENT" || true
}
