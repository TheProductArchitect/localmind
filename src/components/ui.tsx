"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * UI primitives — v2 dark/mono.
 *
 * APIs are unchanged from v1 so existing pages keep working. The visual
 * language was rebuilt to match the v2 token system (mono canvas, white
 * glow accent, hairline borders, no paper shadows).
 *
 * "default" Button is the white-on-dark CTA; pages that want the quieter
 * outline look (most admin pages) should pass variant="outline" or "ghost".
 */

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "brand";
  size?: "default" | "sm" | "icon";
}) {
  const variants = {
    default:
      "bg-white text-[hsl(234_22%_4%)] hover:shadow-[0_0_18px_hsl(0_0%_100%_/_0.35)]",
    brand:
      "bg-white text-[hsl(234_22%_4%)] hover:shadow-[0_0_18px_hsl(0_0%_100%_/_0.35)]",
    outline:
      "border border-white/10 bg-white/[0.03] text-white/85 hover:bg-white/[0.07] hover:border-white/15",
    ghost:
      "text-white/75 hover:bg-white/[0.05] hover:text-white",
    secondary:
      "bg-white/[0.06] text-white/90 hover:bg-white/[0.10]",
    destructive:
      "bg-[hsl(0_90%_64%)] text-white hover:bg-[hsl(0_90%_60%)]",
  };
  const sizes = {
    default: "h-9 px-4 py-2",
    sm: "h-8 px-3 text-[12.5px]",
    icon: "h-9 w-9",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[12px] text-[13px] font-medium tracking-[-0.005em] transition-[box-shadow,background-color,opacity] duration-150 ease-out disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-1 text-[13px] tracking-[-0.005em] text-white/95 outline-none placeholder:text-white/35 transition-colors focus:border-white/25 disabled:opacity-40",
        className
      )}
      {...props}
    />
  );
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] tracking-[-0.005em] text-white/95 outline-none placeholder:text-white/35 transition-colors focus:border-white/25 disabled:opacity-40",
          className
        )}
        {...props}
      />
    );
  }
);

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[14px] border border-white/[0.07] bg-white/[0.03] text-white/90 backdrop-blur-[14px]",
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "outline" | "warning" | "success" | "destructive" | "brand" }) {
  // v2 simplifies badges to hairline pills. Tone is conveyed by border color
  // and a subtle text shift; no more colored backgrounds (which read as
  // 2018-era "pills on cards" against the dark canvas).
  const variants = {
    default:     "border-white/15 text-white/80",
    brand:       "border-white/30 text-white",
    outline:     "border-white/15 text-white/80",
    warning:     "border-[hsl(40_90%_60%/0.4)] text-[hsl(40_100%_78%)]",
    success:     "border-white/30 text-white",
    destructive: "border-[hsl(0_90%_64%/0.4)] text-[hsl(0_100%_78%)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-px text-[10.5px] font-medium uppercase tracking-[0.04em]",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16">
      <p className="lm-display" style={{ fontSize: 22, lineHeight: "30px" }}>{title}</p>
      <p className="lm-body mt-2 max-w-md" style={{ color: "hsl(0 0% 100% / 0.5)" }}>{hint}</p>
    </div>
  );
}
