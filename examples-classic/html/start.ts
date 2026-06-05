import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  // Upon request, render the HTML form and return it
  requestBody.context.onWorkflowMessage((_message) => {
    return renderHtml(requestBody);
  });

  // Wait for the form to be submitted
  const name = await new Promise((resolve) => {
    requestBody.context.onMessage((message) => {
      resolve(message.name);
    });
  });

  return {
    payload: name,
  };
};

function renderHtml(requestBody: PluginRequestBody): string {
  const url =
    `${requestBody.context.workflowMessageUrl}/${requestBody.context.id}`;
  return `<!DOCTYPE html>
<html>
<head>
  <title>Workflow</title>
</head>
<body>
  <form>
    <p>
      <label for="name">Name:</label>
      <input type="text" id="name" name="name">
    </p>
    <p>
      <button type="submit">Submit</button>
    </p>
  </form>
  <script>
    const form = document.querySelector("form");
    const perform = async (e) => {
      e.preventDefault();
      const name = document.getElementById("name").value
      await fetch("${url}", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "${requestBody.context.authorizationHeader}",
        },
        body: JSON.stringify({ name }),
      });
      form.innerHTML = "<p>Thank you, " + name + "!</p>";
    };
    form.addEventListener("submit", perform);
  </script>
</body>
</html>
`;
}
