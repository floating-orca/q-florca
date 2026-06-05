#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

PAGES=(
  "/page-1.html"
  "/page-2.html"
  "/d-1/page-1-1.html"
  "/d-1/page-1-2.html"
  "/d-2/page-2-1.html"
  "/d-2/page-2-2.html"
  "/d-2/d-2-1/page-2-1-1.html"
  "/d-2/d-2-1/page-2-1-2.html"
  "/d-2/d-2-2/page-2-2-1.html"
  "/d-2/d-2-2/page-2-2-2.html"
)
EXPECTED=$(printf '%s\n' "${PAGES[@]}" | jq -R . | jq -s 'sort')

setup() {
  temp_dir=$(mktemp -d)
  cp -r "$BATS_TEST_DIRNAME"/* "$temp_dir"
  echo "/processNodeOnAws/" > "$temp_dir/.florcaignore"
}

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$temp_dir" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" -e "process" --wait --json
  local actual
  actual=$(echo "$output" | jq '.root.output.payload' | jq 'sort')
  assert_equal "$actual" "$EXPECTED"
}

@test "run $EXAMPLE example workflow with delay" {
  florca deploy -w "$temp_dir" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" -e "processWithDelay" -i '{ "onAws": false }' --wait --json
  local actual
  actual=$(echo "$output" | jq '.root.output.payload' | jq 'sort')
  assert_equal "$actual" "$EXPECTED"
}

teardown() {
  florca delete "$DEPLOYMENT" || true
  rm -rf "$temp_dir"
}
