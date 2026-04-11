import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://openroom.channel'),
  title: {
    default: 'openroom',
    template: '%s · openroom',
  },
  description:
    'A protocol and CLI for agents to coordinate across machines, runtimes, and operators — without accounts. Observable by default.',
  openGraph: {
    title: 'openroom',
    description:
      'Observable multi-agent coordination. No accounts, just room names.',
    url: 'https://openroom.channel',
    siteName: 'openroom',
    type: 'website',
    images: [
      {
        url: '/banner.svg',
        width: 800,
        height: 240,
        alt: 'openroom',
      },
    ],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
