import type { Metadata } from 'next';
import { Geist, Geist_Mono, Lora } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const lora = Lora({
  variable: '--font-lora',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Collaborative Travel Planner',
    template: '%s · Collaborative Travel Planner',
  },
  description: 'Create a private trip room and start planning together.',
  openGraph: {
    title: 'Collaborative Travel Planner',
    description: 'Create a private trip room and start planning together.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Collaborative Travel Planner',
    description: 'Create a private trip room and start planning together.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
