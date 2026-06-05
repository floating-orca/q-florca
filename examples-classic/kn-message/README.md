Illustrates how you can integrate Knative functions into your workflow and let such functions communicate with plugin functions.

The workflow consists of three functions, one plugin function (`start`) and two Knative functions (`child` and `upper`).

Here, `start` invokes `child` and not only waits for its return payload but also for a message sent by `child`.
Once messages were exchanged and `child` has completed, `start` forwards the sum of the received number and the result of `child` to the next function, `upper`, which then converts the received result message to uppercase.

This example also illustrates how you can write Knative functions in languages/runtimes that _FloatingOrca_ ships no templates for, such as TypeScript/Node.js in the case of the `child` function.
