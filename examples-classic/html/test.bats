#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

# shellcheck disable=SC1091
source .env
CREDENTIALS=$(echo -n "$BASIC_AUTH_USERNAME:$BASIC_AUTH_PASSWORD" | base64)

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --json
  run_id=$(echo "$output" | jq -r '.runId')
  sleep 1

  run curl --location "http://engine.florca.localhost:8080/$run_id" \
    --header 'Content-Type: application/json' \
    --header "Authorization: Basic $CREDENTIALS" \
    --silent \
    --fail
  assert_success

  url=$(echo "$output" | grep -oP 'await fetch\("\K[^"]+')
  data='{"name":"My Name"}'
  run curl -X POST --location "$url" \
    --data "$data" --header 'Content-Type: application/json' \
    --header "Authorization: Basic $CREDENTIALS" \
    --silent \
    --fail
  assert_success
  sleep 1

  run florca inspect "$run_id"
  assert_output --partial 'Output: "My Name"'
}

teardown() {
  florca kill -a
  florca delete "$DEPLOYMENT" || true
}
