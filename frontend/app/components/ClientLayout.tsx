'use client';
import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div
          onClick={closeSidebar}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 48,
            cursor: 'pointer',
          }}
        />
      )}

      {/* Sidebar wrapper — fixed overlay on mobile, static on desktop */}
      <div
        style={
          isMobile
            ? {
                position: 'fixed',
                left: 0,
                top: 0,
                bottom: 0,
                zIndex: 49,
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 0.25s ease',
              }
            : { position: 'relative', flexShrink: 0 }
        }
      >
        <Sidebar onClose={closeSidebar} isMobile={isMobile} />
      </div>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Mobile header bar */}
        {isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0 16px',
              height: 52,
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg2)',
              flexShrink: 0,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                color: 'var(--text2)',
                fontSize: 16,
                padding: '4px 8px',
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              ☰
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.05em' }}>
              ◈ MOMENTUM
            </span>
          </div>
        )}

        {/* Page content */}
        <div style={{ flex: 1, padding: isMobile ? '16px' : '24px', overflowY: 'auto' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
