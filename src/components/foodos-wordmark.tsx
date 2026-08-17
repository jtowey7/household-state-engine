/**
 * FoodOS wordmark — pure CSS/text treatment, no external asset or logo service.
 * Presentation only.
 */
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
  const mark = size === "lg" ? "h-9 w-9 text-xl" : size === "sm" ? "h-6 w-6 text-[13px]" : "h-8 w-8 text-base";

  return (
    <span className="flex min-w-0 items-center gap-2">
      {showMark ? (
        <span
          aria-hidden
          className={`grid ${mark} shrink-0 place-items-center rounded-[0.7rem] bg-primary font-display font-bold leading-none text-primary-foreground shadow-[var(--ctl-shadow)]`}
        >
          f
        </span>
      ) : null}
      <span
        className={`font-display ${text} font-semibold leading-none tracking-[-0.02em] text-foreground`}
      >
        food
        <span className="text-primary">OS</span>
      </span>
    </span>
  );
}
