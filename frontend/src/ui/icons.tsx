import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});

export const I = {
  Logo: ({ size = 16, ...p }: P) => (<svg {...base(size)} {...p} strokeWidth={2.4}><path d="M6 4l12 8-12 8z" fill="currentColor" stroke="none" /><path d="M14 4h4M14 20h4" /></svg>),
  Home: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z" /></svg>),
  Grid: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="4" y="4" width="6.5" height="9" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6" rx="1.5" /><rect x="4" y="16" width="6.5" height="4" rx="1.5" /><rect x="13.5" y="13" width="6.5" height="7" rx="1.5" /></svg>),
  Brand: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><circle cx="12" cy="16" r="3" /></svg>),
  Taste: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>),
  Plus: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>),
  X: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>),
  Back: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M15 6l-6 6 6 6" /></svg>),
  Play: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" /></svg>),
  Pause: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" /></svg>),
  Undo: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>),
  Redo: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></svg>),
  Split: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3v18" /><path d="M8 7H4v10h4M16 7h4v10h-4" /></svg>),
  Trash: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg>),
  Send: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 19V5M6 11l6-6 6 6" /></svg>),
  Upload: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>),
  Export: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>),
  Film: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" /></svg>),
  Image: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16l-5-5-9 8.5" /></svg>),
  Screen: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><circle cx="12" cy="10" r="2" fill="currentColor" /></svg>),
  Music: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>),
  Wave: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0" /></svg>),
  Text: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 6V4h14v2M12 4v16M9 20h6" /></svg>),
  Spark: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" /></svg>),
  Script: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h7M9 16h5" /></svg>),
  Check: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>),
  Search: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>),
  Person: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>),
  Sun: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>),
  Moon: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" /></svg>),
  Safe: ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="4" y="3" width="16" height="18" rx="2" strokeDasharray="3 2.5" /></svg>),
};
