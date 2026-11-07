import { qrModules } from "../qr-codes.ts";

/** A QR code as SVG, one path of dark squares: sharp at any print size. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, dark } = qrModules(text);
  let d = "";
  dark.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      data-qr-text={text}
      className="h-auto w-full max-w-56"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
