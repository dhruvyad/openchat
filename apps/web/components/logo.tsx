// Icon-only version of the openroom logomark. Uses `currentColor` so it
// inherits the foreground color from whichever Tailwind/theme context
// it's rendered in — no dark/light variant management needed.
//
// Polygons are lifted from .github/assets/banner.svg (the README banner)
// with the nested transform collapsed into a clean viewBox.

interface LogoProps {
    className?: string;
    title?: string;
}

export function Logo({ className, title = 'openroom' }: LogoProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="280 170 420 830"
            role="img"
            aria-label={title}
            className={className}
        >
            <g
                fill="none"
                stroke="currentColor"
                strokeWidth="48"
                strokeLinejoin="round"
                strokeLinecap="round"
            >
                <polygon points="305,245 678,194 679,980 305,922" />
                <polygon points="305,245 554,312 553,798 305,921" />
            </g>
            <polygon
                points="634,632 600,674 600,712 634,670"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="10"
                strokeLinejoin="round"
            />
        </svg>
    );
}
