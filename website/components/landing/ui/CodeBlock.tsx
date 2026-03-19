interface CodeBlockProps {
  children: React.ReactNode;
  variant?: "error" | "success";
  className?: string;
}

export function CodeBlock({
  children,
  variant,
  className = "",
}: CodeBlockProps) {
  const borderColor =
    variant === "error"
      ? "border-red-500/30"
      : variant === "success"
        ? "border-[#4ade80]/30"
        : "border-[#27272a]";

  return (
    <pre
      className={`overflow-x-auto rounded-lg border bg-[#0d1117] p-4 font-mono text-sm text-[#e4e4e7] ${borderColor} ${className}`}
    >
      {children}
    </pre>
  );
}
