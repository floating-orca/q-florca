#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --wait
  assert_output --partial 'Output: 9'
  duration=$(echo "$output" | grep 'Workflow: ' | sed -nE 's/.*(PT([0-9]+)\.?[0-9]*S).*/\2/p')
  if ! [[ "$duration" -ge 5 ]]; then
    fail "Workflow duration $duration seconds is less than expected"
  fi
}

teardown() {
  florca delete "$DEPLOYMENT" || true
}
