import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { sendMessageToParent } from "@florca/fn";

type Input = {
	path: string
};

export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const input = requestBody.payload as Input;
	const context = requestBody.context;

	let data = await context.run("link-extraction-aws", { path: input.path })

	await sendMessageToParent(
		data.pageLinks,
		context
	);

	return {
		payload: {
			start: data.start,
			end: data.end,
			links: data.videoLinks
		},
		next: undefined,
	};
};
