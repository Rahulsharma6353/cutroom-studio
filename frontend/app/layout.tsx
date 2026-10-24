import type { Metadata } from 'next';
import '@shared/styles/fonts';
import '@fontsource-variable/archivo/standard.css';
import '@fontsource-variable/archivo/standard-italic.css';
import { THEME_BOOT } from '../src/lib/theme-boot';
import '@shared/styles/frame.css';
import '../src/styles/app.css';

export const metadata: Metadata = {
  title: 'Cutroom Studio',
  description: 'Drop your footage. Get a finished edit you can change by chatting.',
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
