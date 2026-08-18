/**
 * FoodOS wordmark — pure CSS treatment, no external asset, icon, or badge.
 * Presentation only.
 */
export function FoodOsWordmark({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const text =
    size === "lg"
      ? "text-2xl sm:text-3xl"
      : size === "sm"
        ? "text-[15px]"
        : "text-[19px]";

  return (
    <span className="flex min-w-0 items-center">
      <span
        className={`font-display ${text} font-semibold leading-none tracking-[-0.02em] text-foreground`}
      >
        food
        <span className="text-primary">OS</span>
      </span>
    </span>
  );
}
