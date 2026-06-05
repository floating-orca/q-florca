import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import type { Edge, ComputedUpdate, Node } from "./shared.ts";

type Input = {
	to: Node,
	edges: Edge[],
	distances: number[]
};

export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const input = requestBody.payload as Input;

	let result: ComputedUpdate | null = null;

	let distance = input.distances[input.to];
	for (const edge of input.edges) {
		if (input.distances[edge.from] + edge.weight < distance) {
			distance = input.distances[edge.from] + edge.weight;
			result = { from: edge.from, to: edge.to, distance: distance };
		}
	}

	return {
		payload: result,
		next: undefined,
	};
};
