import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconPulse = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2 12h4l2.5-7L12 19l2.5-7H22" />
  </svg>
);

export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </svg>
);

export const IconScan = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
    <path d="M3 12h18" />
  </svg>
);

export const IconDatabase = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13" />
    <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
  </svg>
);

export const IconDoc = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z" />
    <path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5" />
  </svg>
);

export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 20.5h18" />
    <rect x="5" y="11" width="3.4" height="7" rx="1" />
    <rect x="10.3" y="6.5" width="3.4" height="11.5" rx="1" />
    <rect x="15.6" y="14" width="3.4" height="4" rx="1" />
  </svg>
);

export const IconTerminal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3.5" width="19" height="17" rx="2.4" />
    <path d="M7 9.5l2.5 2.5L7 14.5M12.5 15h5" />
  </svg>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5 21 21" />
  </svg>
);

export const IconBolt = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13.5 2.5 5 13.5h5l-1 8 8.5-11h-5z" />
  </svg>
);

export const IconGit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="6" cy="5" r="2.4" />
    <circle cx="6" cy="19" r="2.4" />
    <circle cx="18" cy="12" r="2.4" />
    <path d="M6 7.4v9.2M8.4 5h5.2A4.4 4.4 0 0 1 18 9.4v.4" />
  </svg>
);

export const IconBrain = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5.2A4.2 4.2 0 0 0 4.6 7.6 3.6 3.6 0 0 0 4.2 14a3.9 3.9 0 0 0 3.4 5.4A3.4 3.4 0 0 0 12 18.6z" />
    <path d="M12 5.2a4.2 4.2 0 0 1 7.4 2.4 3.6 3.6 0 0 1 .4 6.4 3.9 3.9 0 0 1-3.4 5.4A3.4 3.4 0 0 1 12 18.6z" />
  </svg>
);

export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 2.8 5 5.5v6c0 4.4 2.9 8 7 9.7 4.1-1.7 7-5.3 7-9.7v-6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3.2 2" />
  </svg>
);

export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 16.4h.01" />
  </svg>
);

export const IconRepeat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9M20.5 12a8.5 8.5 0 0 1-14.6 5.9" />
    <path d="M18.5 3v3.4h-3.4M5.5 21v-3.4h3.4" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.4 2.6 2.6L16 9.6" />
  </svg>
);

export const IconLayers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m12 3 8.5 4.6L12 12.2 3.5 7.6z" />
    <path d="m3.5 12.4 8.5 4.6 8.5-4.6M3.5 16.8l8.5 4.6 8.5-4.6" />
  </svg>
);

export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8.4" r="3.9" />
    <path d="M4.8 20.4a7.6 7.6 0 0 1 14.4 0" />
  </svg>
);

export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" />
  </svg>
);

export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20.5 11a8.5 8.5 0 0 0-14.6-5.4M3.5 13a8.5 8.5 0 0 0 14.6 5.4" />
    <path d="M3.5 5v4.2H7.7M20.5 19v-4.2h-4.2" />
  </svg>
);

export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
  </svg>
);

export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="12" height="12" rx="2.2" />
    <path d="M15 6.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1.5" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />
  </svg>
);
