def handler(request_body, _):
    print("This is a log message")
    # raise Exception("This is an error")
    return {
        "payload": request_body["payload"].replace(".png", ".jpg"),
    }
