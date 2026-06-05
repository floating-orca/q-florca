Illustrates how you could deal with data dependencies using custom plugin functions and Promises.

The example shows two functions:

- `plusOne`: Takes a single input and can run in parallel unconstrained.
- `sum`: Takes two inputs and can only run when both inputs are available.

The `example.ts` entry point runs `plusOne` locally, while `contextExample.ts` utilizes an AWS Lambda function `increment` to perform the same task.
