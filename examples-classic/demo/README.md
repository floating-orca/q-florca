A simple example with one plugin function and two AWS Lambda functions.

`fetchPaths.ts` nicely illustrates how we can let Deno import modules from a URL, in this case the `@std/random` module hosted on Deno's JSR.
You could also import NPM modules by prefixing them with `npm:` instead of `jsr:`.
