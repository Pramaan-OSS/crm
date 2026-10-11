import { cn } from "@crm/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

// The mark: an ink tile with one dot (see components/logo.tsx).
const TILE =
	"M14 0h36a14 14 0 0 1 14 14v36a14 14 0 0 1-14 14H14A14 14 0 0 1 0 50V14A14 14 0 0 1 14 0Z";

const spinnerVariants = cva("shrink-0", {
	variants: {
		size: {
			default: "size-4",
			lg: "size-10",
		},
	},
	defaultVariants: {
		size: "default",
	},
});

function Spinner({
	className,
	size,
	...props
}: React.ComponentProps<"svg"> & VariantProps<typeof spinnerVariants>) {
	return (
		<svg
			data-slot="spinner"
			role="status"
			aria-label="Loading"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 64 64"
			fill="none"
			className={cn(spinnerVariants({ size }), className)}
			{...props}
		>
			<path d={TILE} fill="currentColor" fillOpacity={0.85} />
			<circle
				cx={32}
				cy={32}
				r={18}
				stroke="var(--background, #ffffff)"
				strokeWidth={8}
				strokeLinecap="round"
				pathLength={100}
				strokeDasharray="40 60"
				className="animate-spinner-trace"
			/>
		</svg>
	);
}

export { Spinner };
