import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Button({
  children,
  className,
  loading,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "bg-[#176b5b] text-white hover:bg-[#115648]",
        variant === "secondary" && "border border-[#cbd6d2] bg-white text-[#24332f] hover:bg-[#f2f6f4]",
        variant === "danger" && "border border-[#e8c8c5] bg-white text-[#9b3129] hover:bg-[#fff4f2]",
        variant === "ghost" && "text-[#44534f] hover:bg-[#edf3f0]",
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-[#cbd6d2] bg-white px-3 text-sm text-[#192622] outline-none transition focus:border-[#23816e] focus:ring-2 focus:ring-[#23816e]/15",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-[#dce5e1] bg-white", className)}>
      {children}
    </section>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-[#192622]">{title}</h2>
        {description && <p className="mt-1 text-sm text-[#66736f]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 text-[#7b8985]">{icon}</div>
      <p className="font-medium text-[#2a3834]">{title}</p>
      <p className="mt-1 max-w-md text-sm text-[#7b8985]">{text}</p>
    </div>
  );
}
