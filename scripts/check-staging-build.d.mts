export function stagingNameOf(configText: string): string;
export function builtConfigProblems(built: { name?: unknown } | null, stagingName: string): string[];
export function webPagesProblems(htmlTexts: string[], stagingKey: string, topKey: string): string[];
export const ADMIN_AUX_TARGETS: Record<"admin-api" | "admin-finance", { config: string; dist: string }>;
export function problemsFor(target: string): string[];
