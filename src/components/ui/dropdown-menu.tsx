import * as React from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;

function DropdownMenuContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 min-w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-sm px-3 py-2 text-sm outline-hidden select-none focus:bg-accent data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
