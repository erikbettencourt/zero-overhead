import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Toasts, themed with our tokens. Follows the system light or dark setting. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-center"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: "font-sans shadow-lg", description: "text-muted-foreground" } }}
      {...props}
    />
  );
}

export { Toaster };
