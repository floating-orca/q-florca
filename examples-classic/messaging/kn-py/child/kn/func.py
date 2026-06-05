from fn import send_message, send_message_to_parent, send_message_to_workflow


def handle(request_body: dict) -> dict:
    input = request_body["payload"]
    context: dict = request_body["context"]
    response = send_message_to_parent(input, context)
    return {
        "payload": response,
        "next": None,
    }


def main(c):
    return handle(c.request.get_json()), 200
