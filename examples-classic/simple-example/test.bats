#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --wait --json
  message=$(echo "$output" | jq -r '.output')
  number=$(echo "$output" | jq '.root.output.payload')
  if [ $((number % 2)) -eq 0 ]; then
    assert_equal "$message" "The number ${number} is even."
  else
    assert_equal "$message" "The number ${number} is odd."
  fi
}

teardown() {
  florca delete "$DEPLOYMENT" || true
}
