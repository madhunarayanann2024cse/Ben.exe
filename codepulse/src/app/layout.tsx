import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'CodePulse — AI Incident Memory & Root-Cause Intelligence',
  description:
    'CodePulse — Your Engineering Team Never Forgets. Paste a production stack trace, match it against historical RCAs with vector search, predict the root cause, reuse the engineer\'s fix and generate the post-mortem.',
  applicationName: 'CodePulse',
  keywords: ['incident memory', 'root cause analysis', 'RCA', 'post-mortem', 'SRE', 'pgvector', 'AI'],
  authors: [{ name: 'CodePulse' }],
};

export const viewport: Viewport = {
  themeColor: '#05060b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
