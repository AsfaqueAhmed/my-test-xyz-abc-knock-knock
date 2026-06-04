import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Sidebar } from './components/Sidebar';

export const metadata: Metadata = {
  title: 'Momentum Trading Platform',
  description: 'Binance Futures Momentum Trading Bot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div style={{ display: 'flex', minHeight: '100vh' }}>
            <Sidebar />
            <main style={{ flex: 1, padding: '24px', overflowY: 'auto', minHeight: '100vh' }}>
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
