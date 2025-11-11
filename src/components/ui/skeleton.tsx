function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded-md bg-gray-800/50 ${className || ""}`}
      {...props}
    />
  )
}

export { Skeleton }
