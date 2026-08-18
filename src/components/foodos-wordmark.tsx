/**
 * FoodOS wordmark — pure CSS/SVG treatment, no external asset or logo service.
 * Presentation only.
 *
 * The companion glyph is a discreet open "f" flow stroke with a small node
 * terminal (subtle computing character). It is deliberately not a filled
 * badge/circle, so it never reads as a social-media app icon.
 */
function FoodOsGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* flow stem: lowercase f rising out of a food/flow curve */}
      <path
        d="M7.5 20.5V9.2c0-3.2 1.9-5.2 4.8-5.2 1 0 1.8.2 2.4.5"
        stroke="currentColor"
        strokeWidth="2.1"
        className="text-primary"
      />
      {/* crossbar */}
      <path
        d="M4.8 11.6h7.4"
        stroke="currentColor"
        strokeWidth="2.1"
        className="text-primary"
      />
      {/* restrained secondary arc: the "OS" loop / system return path */}
      <path
        d="M14.4 12.4c2.9.7 4.4 2.6 4.4 4.6"
        stroke="currentColor"
        strokeWidth="1.7"
        className="text-primary/45"
      />
      {/* node terminal */}
      <circle cx="18.8" cy="19.4" r="1.7" fill="currentColor" className="text-primary/45" />
    </svg>
  );
}

export function FoodOsWordmark({
  size = "md",
  showMark = true,
}: {
  size?: "sm" | "md" | "lg";
  showMark?: boolean;
}) {
  const text =
    size === "lg"
      ? "text-2xl sm:text-3xl"
      : size === "sm"
        ? "text-[15px]"
        : "text-[19px]";
  const mark = size === "lg" ? "h-7 w-7" : size === "sm" ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]";

  return (
    <span className="flex min-w-0 items-center gap-[7px]">
      {showMark ? <FoodOsGlyph className={`${mark} shrink-0`} /> : null}
      <span
        className={`font-display ${text} font-semibold leading-none tracking-[-0.02em] text-foreground`}
      >
        food
        <span className="text-primary">OS</span>
      </span>
    </span>
  );
}
