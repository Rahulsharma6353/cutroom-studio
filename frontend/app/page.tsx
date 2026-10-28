'use client';
import dynamic from 'next/dynamic';

// The studio reads projects saved in this browser, so it renders on the client only.
const App = dynamic(() => import('../src/ui/App').then((m) => m.App), { ssr: false });

export default function Page() {
  return <App />;
}
