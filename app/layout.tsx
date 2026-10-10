import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Context — Grounded AI Research',
  description: 'A hybrid retrieval workspace for grounded answers from your documents.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
