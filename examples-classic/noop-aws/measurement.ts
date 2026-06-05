import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type Input = {
	fn: string,
	input: any
};

export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const input = requestBody.payload as Input;
	const context = requestBody.context;

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
