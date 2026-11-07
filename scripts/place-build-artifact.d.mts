export type Placement = { from: string; to: string; type: "file" | "dir" };
export const PLACEMENTS: Readonly<Record<"staging" | "production", readonly Placement[]>>;
export const SECRET_NAME: RegExp;
export function placementProblems(scope: string, fromDir: string, root?: string): string[];
export function placeArtifact(
  scope: string,
  fromDir: string,
  root?: string,
): { problems: string[]; copied: number };
