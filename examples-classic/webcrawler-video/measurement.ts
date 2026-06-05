import type { PluginRequestBody, ResponseBody } from "@florca/fn";

import { sendMessageToParent } from "@florca/fn";

type Input = {
	fn: string,
	input: any
};

export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const input = requestBody.payload as Input;
	const context = requestBody.context;

	context.onMessage(async function (msg: any) {
		return await sendMessageToParent(msg, context);
	});

	const start = new Date();

	const result = await context.run(input.fn, input.input);

	const end = new Date();

	return {
		payload: {
			start: start,
			end: end,
			result: result
		},
		next: undefined,
	};
};
