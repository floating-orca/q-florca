import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type Params = {
	iterations: number,
	workers: number
};

export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const context = requestBody.context;
	const params = context.params as Params;

	let stats: any[] = [];

	let requests: Promise<any>[] = [];
	let collectionInput: any = { iterations: params.iterations };
	for (let i = 0; i < params.workers; i++) {
		requests.push(context.run("measurement", {
			fn: "noop-aws",
			input: collectionInput
		}));
	}

	let results: any[] = await Promise.all(requests);
	stats = stats.concat(results.map(it => {
		return {
			submission: it.start,
			start: it.result.start,
			end: it.result.end,
			received: it.end
		}
	}));

	return {
		payload: {
			evaluated: {},
			stats: stats
		},
	};
};
