# bidirectional-aws-messaging

A premium example illustrating **fully decentralized parent-child bidirectional SQS messaging** (`context.onMessage` / `sendMessageToParent`) without any central HTTP orchestrator.

## How it Works

1. **Parent Orchestrator (`start/aws/index.js`)**:
   - Registers a message handler using `context.onMessage((msg) => msg * 10)`.
   - Invokes the child function (`child`) via `context.run("child", 5)`.
   - The parent enters `runPoller` to poll its unique private `inboxQueueUrl`.
2. **Child Function (`child/aws/index.js`)**:
   - Imports `sendMessageToParent` from `./fn.js`.
   - Calls `sendMessageToParent(5, context)` which sends a `"user_request"` SQS message directly to the parent's private `${parentId}-inbox` queue, including its own inbox queue URL as `senderReturnTo`.
   - The child enters `runPoller` to poll its own private `inboxQueueUrl` waiting for the reply.
3. **Execution & Resolution**:
   - The parent captures the SQS request, runs the registered `onMessage` callback (resulting in `50`), and posts a `"user_reply"` back to the child's return SQS queue.
   - The child captures the reply, unblocks, and completes with `{ payload: 50 }`.
   - The parent receives the child's final outcome on its inbox queue, resolves `context.run` to `50`, and exits.
