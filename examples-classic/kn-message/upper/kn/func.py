def handle(request_body: dict) -> dict:
    input = request_body["payload"]
    return {
        "payload": input.upper(),
        "next": None,
    }


def main(c):
    return handle(c.request.get_json()), 200
