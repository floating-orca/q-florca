import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type Input = {
	url: string
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const input = requestBody.payload as Input;
	const context = requestBody.context;

	const { promise: links, resolve } = Promise.withResolvers<number>();

	const invocations: Promise<any>[] = [];
	let executed: number = 0;
	const crawled: string[] = [];

	let stats: any[] = [];

	context.onMessage((paths: string[]) => {
		for (const path of paths) {
			invokeProcessNode(path);
		}
	});

	const invokeProcessNode = (path: string) => {
		console.log("Starting: " + path)

		if (crawled.includes(path)) {
			return;
		}

		crawled.push(path);

		const invocation: Promise<any> = context.run("measurement", {
			fn: "crawl",
			input: { path: path }
		});

		invocations.push(invocation);
		invocation.then(async (result) => {
			stats.push({
				submission: result.start,
				start: result.result.start,
				end: result.result.end,
				received: result.end
			});

			executed += 1;

			await sleep(100);

			if (executed == invocations.length) {
				resolve(0);
			}
		});
	};

	invokeProcessNode(input.url);

	return {
		payload: {
			links: await links,
			stats: stats
		},
		next: undefined,
	};
};
