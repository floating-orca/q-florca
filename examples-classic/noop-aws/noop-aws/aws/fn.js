/**
 * @param {any} message
 * @param {number|null} receivingInvocation
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
