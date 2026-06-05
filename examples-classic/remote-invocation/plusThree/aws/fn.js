/**
 * @param {any} message
 * @param {string|null} receivingInvocation
 * @param {any} context
 * @returns {Promise<any>}
 */
async function sendMessage(message, receivingInvocation, context) {
  let url = context.workflowMessageUrl;
  if (receivingInvocation !== null) {
    url += `/${receivingInvocation}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: context.authorizationHeader,
    },
    body: JSON.stringify(message),
  });
  return await response.json();
}

/**
 * @param {any} message
 * @param {any} context
 * @returns {Promise<any>}
 */
async function sendMessageToParent(message, context) {
  const parentId = context.parentId;
  if (parentId === null) {
    throw new Error("No parent to send message to");
  }
  return await sendMessage(message, parentId, context);
}

/**
 * @param {any} message
 * @param {any} context
 * @returns {Promise<any>}
 */
async function sendMessageToWorkflow(message, context) {
  return await sendMessage(message, null, context);
}

exports.sendMessage = sendMessage;
exports.sendMessageToParent = sendMessageToParent;
exports.sendMessageToWorkflow = sendMessageToWorkflow;

const run = async (fn, payload, context) => {
  const { authorizationHeader, id, workflowMessageUrl } = context;
  let functionName;
  let params;
  if (typeof fn === "string") {
    functionName = fn;
  } else {
    functionName = Object.keys(fn)[0];
    params = fn[functionName];
  }
  const invokeChildArgs = {
    functionName,
    input: payload,
    params: params ?? null,
    parent: id,
  };
  const headers = {
    "Content-Type": "application/json",
    Authorization: authorizationHeader,
  };
  const response = await fetch(`${workflowMessageUrl}/invoke`, {
    method: "POST",
    headers,
    body: JSON.stringify(invokeChildArgs),
  });
  return await response.json();
};

exports.run = run;
