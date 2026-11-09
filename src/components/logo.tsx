import { cn } from "@/lib/utils";

/**
 * The Zero Overhead mark: a zero with a slash running through it, in signal blue.
 * Uses the `now` token, so it follows light and dark mode with the rest of the app.
 */
export function LogoMark({ className, title = "Zero Overhead" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={title} className={cn("size-7 text-now", className)}>
      <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" strokeWidth="7" />
      <line x1="9" y1="55" x2="55" y2="9" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" />
    </svg>
  );
}
