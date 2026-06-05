from fn import send_message, send_message_to_parent, send_message_to_workflow, run


def handle(request_body: dict) -> dict:
    input = request_body["payload"]
    context: dict = request_body["context"]
    result = input + run("plusOne", 3, context);
    return {
        "payload": result,
        "next": "double",
    }


def main(c):
    return handle(c.request.get_json()), 200
