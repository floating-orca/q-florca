import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { Node, Edge, ComputedUpdate } from "./shared.ts";

type Input = {
	start: Node,
	goal: Node,
	edges: Edge[],
	vertices: number
};

export default async (
	requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
	const input = requestBody.payload as Input;
	const context = requestBody.context;

	const distances: number[] = new Array(input.vertices).fill(Infinity);
	const predecessors: number[] = new Array(input.vertices).fill(-1);

	distances[input.start] = 0;

	const groups = groupEdgesByTargetNode(input.edges);

	for (let i = 0; i < input.vertices; i++) {
		const updates: Promise<ComputedUpdate | null>[] = [];

		for (const groupedEdges of groups.values()) {
			updates.push(context.run("compute-node", {
				to: groupedEdges[0].to,
				edges: groupedEdges,
				distances: distances
			}));
		}

		const results = await Promise.all(updates);

		let changes = false;
		for (const update of results) {
			if (update == null) {
				continue;
			}

			distances[update.to] = update.distance;
			predecessors[update.to] = update.from;
			changes = true;
		}

		if (!changes) {
			break;
		}
	}

	let path: Node[] = pathReconstruction(input.start, input.goal, predecessors);
	return {
		payload: path,
		next: undefined,
	};
};

function groupEdgesByTargetNode(edges: Edge[]): Map<Node, Edge[]> {
	const result = new Map<Node, Edge[]>();

	for (const edge of edges) {
		if (!result.has(edge.to)) {
			result.set(edge.to, []);
		}
		result.get(edge.to)!.push(edge);
	}

	return result;
}

function pathReconstruction(start: Node, goal: Node, predecessors: number[]): Node[] {
	if (start == goal) {
		return [start];
	}

	const path: Node[] = [];
	let current: Node = goal;

	while (current != -1 && current != start) {
		path.unshift(current);
		current = predecessors[current];

		if (path.includes(current)) {
			return [];
		}
	}

	if (current == -1) {
		return [];
	}

	path.unshift(start);

	return path;
}
