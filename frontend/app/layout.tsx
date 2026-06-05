import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { ClientLayout } from './components/ClientLayout';

export const metadata: Metadata = {
  title: 'Momentum Trading Platform',
  description: 'Binance Futures Momentum Trading Bot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <ClientLayout>{children}</ClientLayout>
        </Providers>
      </body>
    </html>
  );
}
