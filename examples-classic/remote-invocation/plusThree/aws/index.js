const { run } = require("./fn.js");

exports.handler = async (requestBody) => {
  const input = requestBody.payload;
  const context = requestBody.context;
  const result = input + await run("plusOne", 2, context);
  return {
    payload: result,
    next: "double",
  };
};
