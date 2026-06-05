#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --wait --json
  number=$(echo "$output" | jq '.root.output.payload')
  if ! [[ "$number" -ge 6 && "$number" -le 15 ]]; then
    fail "Output number $number is not between 6 and 15"
  fi
}

teardown() {
  florca delete "$DEPLOYMENT" || true
}
