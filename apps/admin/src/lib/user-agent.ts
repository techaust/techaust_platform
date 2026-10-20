// A small, local user-agent reader for the sessions list: "Chrome on Windows", "Safari on iPhone". It only names
// the browser and the system; it never claims a version or a device model. Unknown parts read "Unknown browser".

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|\bChrome\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

const first = (ua: string, list: [RegExp, string][]) => list.find(([re]) => re.test(ua))?.[1] ?? null;

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown browser";
  const browser = first(ua, BROWSERS);
  const system = first(ua, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : "Unknown browser");
}
