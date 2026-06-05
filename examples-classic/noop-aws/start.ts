import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type Input = {
	iterations: number,
	workers: number
};


export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const input = requestBody.payload as Input;

	return {
		payload: null,
		next: {
			noop_step: {
				iterations: input.iterations,
				workers: input.workers,
			}
		},
	};
};
