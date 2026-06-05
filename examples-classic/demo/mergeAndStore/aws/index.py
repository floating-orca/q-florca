def handler(request_body, _):
    return {
        "payload": request_body["payload"],
    }
