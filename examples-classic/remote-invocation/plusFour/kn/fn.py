import json
from typing import Any, Optional, Dict
from urllib import request, error


def send_message(
    message: Any, receiving_invocation: Optional[int], context: Dict[str, Any]
) -> Any:
    url = context["workflowMessageUrl"]
    if receiving_invocation is not None:
        url += f"/{receiving_invocation}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": context["authorizationHeader"],
    }
    data = json.dumps(message).encode("utf-8")
    req = request.Request(url, data=data, headers=headers, method="POST")
    try:
        with request.urlopen(req) as resp:
            return json.load(resp)
    except error.HTTPError as e:
        raise Exception(f"HTTP error: {e.code} {e.reason}") from e


def send_message_to_parent(message: Any, context: Dict[str, Any]) -> Any:
    parent_id = context.get("parentId")
    if parent_id is None:
        raise Exception("No parent to send message to")
    return send_message(message, parent_id, context)


def send_message_to_workflow(message: Any, context: Dict[str, Any]) -> Any:
    return send_message(message, None, context)


def run(
    fn: Any, payload: Any, context: Dict[str, Any]
) -> Any:
    if isinstance(fn, str):
        function_name = fn
        params = None
    else:
        function_name = next(iter(fn))
        params = fn.get(function_name)
    invoke_child_args = {
      "functionName": function_name,
      "input": payload,
      "params": params,
      "parent": context["id"],
    };
    url = context["workflowMessageUrl"] + "/invoke"
    headers = {
        "Content-Type": "application/json",
        "Authorization": context["authorizationHeader"],
    }
    data = json.dumps(invoke_child_args).encode("utf-8")
    req = request.Request(url, data=data, headers=headers, method="POST")
    try:
        with request.urlopen(req) as resp:
            return json.load(resp)
    except error.HTTPError as e:
        raise Exception(f"HTTP error: {e.code} {e.reason}") from e
