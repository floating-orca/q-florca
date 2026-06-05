export type Node = number;

export interface Edge {
  from: Node;
  to: Node;
  weight: number;
}

export interface ComputedUpdate {
  from: Node;
  to: Node;
  distance: number;
}
