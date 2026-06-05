const { sendMessage, sendMessageToParent, sendMessageToWorkflow } = require("./fn.js");

exports.handler = async (requestBody) => {
  const input = requestBody.payload;
  const context = requestBody.context;
  const response = await sendMessageToParent(input, context);
  return {
    payload: response,
    next: undefined,
  };
};
