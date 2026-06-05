"use strict";

const { sendMessageToParent } = require("./fn.js");

exports.handler = async ({ payload, context }) => {
  console.log("Child received payload:", payload);

  // Send a message directly to the parent's private SQS inbox queue and await the reply
  const reply = await sendMessageToParent(payload, context);

  console.log("Child received reply from parent:", reply);

  return { payload: reply };
};
