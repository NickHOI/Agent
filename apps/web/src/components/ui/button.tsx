import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "icon";

const base =
  "focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-[5px] border text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "border-[#2f81f7] bg-[#2f81f7] text-white hover:border-[#4c91f7] hover:bg-[#4c91f7]",
  secondary: "border-[#343944] bg-[#171a20] text-[#f7f8fa] hover:bg-[#1d2027]",
  danger: "border-[#6e2d2b] bg-[#2b1718] text-[#ffb4b0] hover:bg-[#3a1c1e]",
  ghost: "border-transparent bg-transparent text-[#969da8] hover:bg-[#171a20] hover:text-white"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3",
  md: "h-10 px-4",
  icon: "size-9 p-0"
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

export function ButtonLink({
  href,
  children,
  className,
  variant = "primary",
  size = "md"
}: {
  href: string;
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link href={href} className={cn(base, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}
