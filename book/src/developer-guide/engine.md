# Engine

## API

- `POST /` - Run a workflow
- `GET /` - List all running workflows
- `POST /ready` - Report readiness of the driver
- `GET /{run}/inspection` - Inspect a workflow run, including function invocations' inputs and outputs
- `GET /{run}/status` - Get only the workflow run's status (`running`, `success`, or `error`) without fetching the full inspection tree
- `POST /{run}/invoke` - Invoke a child function (from within a remote function)
- `POST /{run}/events` - Receive batched driver events (invocations, logs)
- `POST /{run}/complete` - Receive workflow completion signal with result
- `POST /{run}/{id}` - Send a message to a function invocation's message handler
- `GET /{run}/{id}` - Retrieve HTML from a function invocation's message handler
- `POST /{run}` - Send a message to the workflow's message handler
- `GET /{run}` - Retrieve HTML from the workflow's message handler
- `DELETE /{run}` - Kill a workflow run

### Example: Inspect a workflow run

The following example shows how to retrieve details about the latest workflow run:

```bash
curl --location 'http://engine.florca.localhost:8080/latest/inspection' \
  --header 'Authorization: Basic <BASE64-ENCODED-BASIC-AUTH-CREDENTIALS>' \
  --silent
```

_Run `echo -n '<BASIC_AUTH_USERNAME>:<BASIC_AUTH_PASSWORD>' | base64` to get the base64-encoded credentials._

Instead of `latest`, you can also pass a specific run ID to get the details of that run. For example, if you want to check the details of a run with ID `5`, you can do:

```bash
curl --location 'http://engine.florca.localhost:8080/5/inspection' \
  --header 'Authorization: Basic <BASE64-ENCODED-BASIC-AUTH-CREDENTIALS>' \
  --silent
```

The response will look something like this:

```json
{
  "runId": 5,
  "deploymentName": "html",
  "entryPoint": "start",
  "input": null,
  "output": "Bob",
  "startTime": "2025-06-28T15:54:05.693274Z",
  "endTime": "2025-06-28T15:54:58.943966Z",
  "root": {
    "invocationId": "f847e5a5-9b7b-4ba0-8f4d-c0e6d2720a17",
    "functionName": "start",
    "input": null,
    "params": null,
    "output": {
      "payload": "Bob"
    },
    "startTime": "2025-06-28T15:54:05.842Z",
    "endTime": "2025-06-28T15:54:58.923Z",
    "children": [],
    "next": null
  },
  "runStatus": "success"
}
```

While the workflow is running, `runStatus` will be `running`. If the workflow failed, it will be `error` and `output` will contain details about the error.

Also note the `children` array and `next` field in the `root` object. If present, they would be structured the same way as the `root` object. `root` essentially represents the entry point invocation of the workflow run.
