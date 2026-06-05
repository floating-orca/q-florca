#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --wait
  assert_output --partial 'Output: [{"computed":["1.md","2.md","3.md"],"content":"# 4.md ## 1.md ## 2.md ## 3.md","filename":"4.md","reused":[]},{"computed":["3.md"],"content":"# 8.md ## 2.md ## 3.md","filename":"8.md","reused":["2.md"]}]'
}

teardown() {
  florca delete "$DEPLOYMENT" || true
}
