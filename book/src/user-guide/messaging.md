# Messaging

One aspect that makes plugin functions special is that they can register message handlers to receive messages from other functions, for example their child functions.

Messages are handled in a synchronous manner, meaning that the message handler can return a response to the sender.

## Registering a message handler

To register a message handler, use the `onMessage` method available on the plugin's `requestBody.context` object and pass a callback function that takes a message as an argument.

To register a workflow-level message handler, use the `onWorkflowMessage` method instead.

<div class="warning">

Note that there can be only one `onMessage` handler per function and one `onWorkflowMessage` handler per workflow. If you register a new handler, it will replace the previous one.

</div>

## Sending messages

Other functions can then send messages to a function that has a message handler registered by using one of the following functions of the `@florca/fn` module:

- `sendMessageToWorkflow(message: any, context: PluginContext)`: Sends a workflow-level message, not targeting a specific plugin function.
- `sendMessageToParent(message: any, context: PluginContext)`: Sends a message to the parent function.
- `sendMessage(message: any, receivingInvocation: InvocationId, context: PluginContext)`: Sends a message to an arbitrary plugin function, identified by its invocation ID.

### The invocation ID

Each function invocation has a unique UUID-based ID that can be used to identify it. This ID is passed to the function as part of the `requestBody.context` object, specifically as `requestBody.context.id`. Furthermore, child functions receive the invocation ID of their parent function as `requestBody.context.parentId`.

If you want to send a message to a function that is not its parent, you need to know the invocation ID of the target function. There's no direct way to find another function's invocation ID, so you need to forward this information to the function in some way. See [Techniques](#techniques) for more information.

## Example

Here is an example of a parent function that registers a message handler, runs a child function `child`, and awaits its result:

```typescript
{{#include ../../../examples/random-response/start.ts}}
```

The child function `child` asks the parent function for a random number between 1 and 10 and adds it to the payload it received:

```typescript
{{#include ../../../examples/random-response/child.ts}}
```

## Sending messages from non-plugin functions

While the `@florca/fn` module provides functions to send messages from plugin functions, you can also send messages from non-plugin functions, such as AWS Lambda or Knative functions.
For the runtimes that _FloatingOrca_ ships templates for, we provide messaging functions via a `fn.js`, `fn.py`, or similar file.
These files are parts of the templates and are copied to the function's implementation directory when you create a new function using the CLI.

However, the functions provided are simple functions that only send HTTP requests, utilizing data that the functions are provided with via `requestBody.context`.
You can easily replicate this behavior in any other language.

Here's how `sendMessageToParent` could be implemented in TypeScript:

```typescript
export async function sendMessageToParent(
  message: any,
  context: PluginContext
): Promise<any> {
  const receivingInvocation = context.parentId;
  const response = await fetch(
    `${context.workflowMessageUrl}/${receivingInvocation}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: context.authorizationHeader,
      },
      body: JSON.stringify(message),
    }
  );
  return await response.json();
}
```

<div class="warning">

You might wonder why we include a `Authorization` header in the request.
This is because the [Caddy](https://caddyserver.com/) reverse proxy has Basic Auth enabled in our setup.
See the [Security](./security.md) chapter for more information.

</div>

`sendMessage` is the same except that it doesn't insert the `parentId` into the URL but you have to provide the `receivingInvocation` as an argument to the function.

`sendMessageToWorkflow` is similar but doesn't require an invocation ID and instead sends a request to the workflow-level message handler.
This means that if you skip the last component of the URL (the `receivingInvocation`), the message will be sent to the workflow-level message handler instead of a specific function.

All required information (`workflowMessageUrl`, `authorizationHeader`, `parentId`) is not only available on the plugin function-specific `PluginContext`, but also on the context passed to [AWS Lambda functions](./aws-lambda-functions.md) and [Knative functions](./knative-functions.md).

See the `examples/messaging/aws-js/child` and `examples/messaging/kn-py/child` functions for examples of how to send messages from AWS Lambda and Knative functions, respectively.

## Techniques

### Promises

Sending messages as well as spawning child functions are asynchronous operations that return promises. Make yourself familiar with the concept of promises if you're not already.

The rather new `Promise.withResolvers` function could be useful when you need to resolve a promise from outside of the promise's scope, for example when you need to resolve a promise from within a message handler.

### Exchanging invocation IDs

#### Let child functions communicate with each other

To let child functions communicate with each other, we first need them to know each other's invocation IDs. This can be achieved by letting the parent function collect the invocation IDs of its children and then distribute them to the children.

The following example demonstrates how the 5 spawned child functions report their IDs to the parent function and receive the IDs of their siblings. Once the child functions receive the IDs of all their siblings, they send their own ID to each sibling. Each sibling waits for all other siblings to send their IDs before returning the sum of all received IDs.

##### Parent function

```typescript
{{#include ../../../examples/siblings/start.ts}}
```

##### Child function

```typescript
{{#include ../../../examples/siblings/sibling.ts}}
```

_In the `examples` directory, there's another workflow called `siblings-timeout`. This workflow demonstrates how to let the parent function abort the workflow if children don't finish in time._
