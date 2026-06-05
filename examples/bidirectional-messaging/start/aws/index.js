"use strict";

module.exports = {
  handler: async ({ payload, context }) => {
    console.log("Parent received start payload:", payload);

    // Register parent onMessage handler to process messages bidirectionally
    context.onMessage((msg) => {
      console.log("Parent received message from child:", msg);
      return msg * 10; // This response is sent directly back to the child!
    });

    // Launch the child function and specify the completion callback
    const inputVal = typeof payload === "number" ? payload : 5;
    await context.run("child", inputVal, "onChildComplete");
  },

  onChildComplete: async ({ results }) => {
    const childResult = results[0];
    console.log("Parent callback resolved child result:", childResult);
    return {
      payload: `Bidirectional SQS messaging complete. Child returned: ${childResult}`,
    };
  }
};
