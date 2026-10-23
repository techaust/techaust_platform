// The public path of the page being built. The site builds with `format: "file"`, so Astro's `Astro.url.pathname` while
// building is the file ("/services/app-rescue.html", "/index.html"); the public URL has neither the extension nor
// "index". Canonical links, share images, breadcrumb and FAQ JSON-LD all use this one function.
export function cleanPath(pathname: string): string {
  const path = pathname.replace(/\.html$/, "").replace(/\/index$/, "");
  return path === "" ? "/" : path;
}
