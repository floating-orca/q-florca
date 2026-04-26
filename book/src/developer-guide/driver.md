# Driver

## API

- `POST /invoke` - Invoke a child function (from within a remote function)
- `POST /` - Send a message to the workflow's message handler
- `POST /:id` - Send a message to a function invocation's message handler
- `GET /` - Retrieve HTML from the workflow's message handler
- `GET /:id` - Retrieve HTML from a function invocation's message handler

## Invocation of individual functions

- For plugin functions, the driver (dynamically) imports the plugin's TypeScript file and invokes the function exported as `default`.
- For AWS Lambda functions, the driver makes use of the official AWS SDK for JavaScript.
- For Knative functions, the driver reads the function's URL from the `functions` table and invokes the function via HTTP.

## Evaluation loop

The following snippet shows the evaluation loop that "drives" the workflow.

After invoking a function, `run` checks if the function returned a `next` value.
If there is no `next`, the branch (or workflow if it's not some child) is complete and the payload is returned.
If there is a `next`, the driver determines the next function to invoke, together with the input and parameters for that function.

Child invocations also enter via the `run` function, with no `predecessor` but with a `parent` set to the invocation ID of the parent function.

```typescript
export const run = async (
  invokeArgs: InvokeArgs,
  driverState: DriverState,
): Promise<Payload> => {
  const { runId, deploymentPath, deploymentName } = invokeArgs;
  let { functionName, input, parent, predecessor, params } = invokeArgs;
  while (true) {
    const [id, response] = await invoke({
      runId,
      deploymentName,
      deploymentPath,
      functionName,
      input,
      parent,
      predecessor,
      params,
    }, driverState);
    const next = response.next;
    if (!next) {
      return response.payload;
    } else if (typeof next === "string") {
      functionName = next;
      input = response.payload;
      params = null;
    } else {
      functionName = Object.keys(next)[0];
      input = response.payload;
      params = next[functionName] ?? null;
    }
    parent = null;
    predecessor = id;
  }
};

const invoke = async (
  invokeArgs: InvokeArgs,
  driverState: DriverState,
): Promise<[InvocationId, ResponseBody]> => {
  const entry = findLookupEntry(
    invokeArgs.functionName,
    driverState.lookupTable,
  );
  const invocationId = crypto.randomUUID();
  let response: ResponseBody;
  if (entry.kind === "aws") {
    response = await invokeAwsFunction(entry, invokeArgs, invocationId);
  } else if (entry.kind === "kn") {
    response = await invokeKnFunction(entry, invokeArgs, invocationId);
  } else if (entry.kind === "plugin") {
    response = await invokePluginFunction(
      entry,
      invokeArgs,
      invocationId,
      driverState,
    );
  } else {
    throw new Error(`Unknown function type: ${entry}`);
  }
  return [invocationId, response];
};

export async function invokePluginFunction(
  entry: LookupEntry,
  invokeArgs: InvokeArgs,
  invocationId: InvocationId,
  driverState: DriverState,
): Promise<ResponseBody> {
  const plugin = await import( // import <my-plugin>.ts
    resolve(invokeArgs.deploymentPath, entry.location)
  );
  const body: PluginRequestBody = {
    payload: invokeArgs.input,
    context: {
      id: invocationId,
      params: invokeArgs.params,
      parentId: invokeArgs.parent,
      run: (fn: string | any, payload: Payload) => {
        // This is the context.run method for invoking
        // a function from within a plugin function
        let functionName;
        let params;
        if (typeof fn === "string") {
          functionName = fn;
        } else {
          functionName = Object.keys(fn)[0];
          params = fn[functionName];
        }
        const runArgs: InvokeArgs = {
          runId: invokeArgs.runId,
          deploymentName: invokeArgs.deploymentName,
          deploymentPath: invokeArgs.deploymentPath,
          functionName,
          input: payload,
          params: params ?? null,
          parent: invocationId,
          predecessor: null,
        };
        return run(runArgs, driverState);
      },
      // ...
    },
  };
  const response = await plugin.default(body);
  return response;
}
```

_Note that only the root function of a child workflow has a `parent` set. Subsequent functions have a `predecessor` set instead._

## IPC

Besides the HTTP API endpoints listed above, the driver also communicates with the engine via standard input & output and files.

In case of standard input & output, the engine continously reads from the driver's output, parses messages (potentially containing JSON), and logs them with log levels and additional metadata such as the ID of the run the driver is associated with.

Finally, before the driver exits, it will write the result of the workflow run to a file. The engine then reads this file to determine the final output and to update the status of the workflow run in the database.
