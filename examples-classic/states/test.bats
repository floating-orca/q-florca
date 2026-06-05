#!/usr/bin/env bats

bats_load_library bats-support
bats_load_library bats-assert

EXAMPLE=$(basename "$BATS_TEST_DIRNAME")
DEPLOYMENT="${EXAMPLE}-test"

send_action() {
  action=$1
  payload=$2 # optional
  local data
  if [ -n "$payload" ]; then
    data="{\"action\":\"$action\",\"payload\":$payload}"
  else
    data="{\"action\":\"$action\"}"
  fi
  run florca message --run-id "$run_id" "$data"
  output=$(echo "$output" | jq -c '.')
}

@test "run $EXAMPLE example workflow" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --json
  run_id=$(echo "$output" | jq -r '.runId')
  sleep 1

  # start to middle via next
  send_action "next" '"payload from start"'
  assert_output '{"actions":["next"],"state":"middle"}'
  sleep 0.1

  # middle to end via next
  send_action "next" '"payload from middle"'
  assert_output '{"actions":["restart","finish"],"state":"end"}'
  sleep 0.1

  # end to start via restart
  send_action "restart" '"payload from end"'
  assert_output '{"actions":["next"],"state":"start"}'
  sleep 0.1

  # start to middle via next again
  send_action "next" '"payload from start again"'
  assert_output '{"actions":["next"],"state":"middle"}'
  sleep 0.1

  # middle to end via next again
  send_action "next" '"payload from middle again"'
  assert_output '{"actions":["restart","finish"],"state":"end"}'
  sleep 0.1

  # finish workflow via finish
  send_action "finish" '"payload from end to finish"'
  assert_output 'null'
}

@test "run $EXAMPLE example workflow without input" {
  florca deploy -w "$BATS_TEST_DIRNAME" "$DEPLOYMENT"
  run florca run -d "$DEPLOYMENT" --json
  run_id=$(echo "$output" | jq -r '.runId')
  sleep 1

  # start to middle via next
  send_action "next"
  assert_output '{"actions":["next"],"state":"middle"}'
  sleep 0.1

  # middle to end via next
  send_action "next"
  florca inspect "$run_id"
  assert_output '{"actions":["restart","finish"],"state":"end"}'
}

teardown() {
  florca kill -a
  florca delete "$DEPLOYMENT" || true
}
