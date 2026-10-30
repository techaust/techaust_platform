export function stagingNameOf(configText: string): string;
export function builtConfigProblems(built: { name?: unknown } | null, stagingName: string): string[];
export function webPagesProblems(htmlTexts: string[], stagingKey: string, topKey: string): string[];
export function problemsFor(target: string): string[];
