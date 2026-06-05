import type { ResponseBody } from "@florca/fn";
import type { Node, Edge } from "./shared.ts";

export default async (): Promise<ResponseBody> => {
	const vertices = 20;
	const edges = generateRandomGraph(vertices);

	const start: Node = Math.floor(Math.random() * vertices);
	const goal: Node = Math.floor(Math.random() * vertices);

	return {
		payload: {
			start,
			goal,
			vertices,
			edges
		},
		next: "algorithm",
	};
};

function generateRandomGraph(
	vertices: number,
	edgeProbability: number = 0.3,
	maxWeight: number = 100,
	allowNegative: boolean = false
): Edge[] {
	const edges: Edge[] = [];

	for (let from = 0; from < vertices; from++) {
		for (let to = 0; to < vertices; to++) {
			if (from !== to && Math.random() < edgeProbability) {
				const weight = allowNegative
					? Math.floor(Math.random() * maxWeight * 2) - maxWeight
					: Math.floor(Math.random() * maxWeight) + 1;

				edges.push({ from, to, weight });
			}
		}
	}

	return edges;
}
