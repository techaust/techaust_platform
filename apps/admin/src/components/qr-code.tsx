// The enrolment QR code (owner's Q3), drawn as one SVG path from uqr's module grid. Always dark on white with the
// standard 4-module quiet zone, in both themes: authenticator apps read dark-on-light most reliably.
import { useMemo } from "react";
import { encode } from "uqr";

/** One path for every dark module ("M x y h1 v1 h-1 z"), plus the grid size including the quiet zone. */
export function qrPath(text: string) {
  const { data, size } = encode(text, { ecc: "M", border: 4 });
  let d = "";
  for (let y = 0; y < size; y++) {
    const row = data[y] ?? [];
    for (let x = 0; x < size; x++) if (row[x]) d += `M${x} ${y}h1v1h-1z`;
  }
  return { d, size };
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const { d, size } = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} className="qr__light" />
      <path d={d} className="qr__dark" />
    </svg>
  );
}
