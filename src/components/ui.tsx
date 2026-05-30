"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

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
    default: "bg-primary text-primary-foreground shadow-soft hover:bg-primary/90",
    brand: "bg-brand text-brand-foreground shadow-soft hover:bg-brand/90",
    outline: "border border-input bg-background shadow-soft hover:bg-accent hover:border-border",
    ghost: "hover:bg-accent",
    destructive: "bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  };
  const sizes = {
    default: "h-9 px-4 py-2",
    sm: "h-8 px-3 text-sm",
    icon: "h-9 w-9",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all duration-200 ease-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
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
        "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-soft transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-soft transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border/70 bg-card text-card-foreground shadow-card", className)}
      {...props}
    />
  );
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "outline" | "warning" | "success" | "destructive" | "brand" }) {
  const variants = {
    default: "bg-secondary text-secondary-foreground",
    brand: "bg-brand-soft text-brand",
    outline: "border border-border text-foreground",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    success: "bg-green-600/15 text-green-700 dark:text-green-300",
    destructive: "bg-destructive/15 text-destructive dark:text-red-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground animate-fade-in">
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-sm mt-1 max-w-md">{hint}</p>
    </div>
  );
}
