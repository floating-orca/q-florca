from fn import send_message, send_message_to_parent, send_message_to_workflow


def handler(request_body: dict, _) -> dict:
    input = request_body["payload"]
    context: dict = request_body["context"]
    response = send_message_to_parent(input, context)
    return {
        "payload": response,
        "next": None,
    }
