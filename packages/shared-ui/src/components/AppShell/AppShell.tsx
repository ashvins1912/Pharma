import React, { useState, useEffect } from 'react';
import styles from './AppShell.module.css';

export const AppShell: React.FC<{ children: React.ReactNode; onLogout?: () => void; showNav?: boolean }> = ({ children, onLogout, showNav = true }) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = isDrawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isDrawerOpen]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.logo}>ENTERPRISE.OS</div>
        {showNav && (
          <>
            <nav className={styles.desktopNav}>
              <button className={styles.navLink} type="button">Dashboard</button>
              {onLogout && <button onClick={onLogout} className={styles.navLink} type="button">Sign Out</button>}
            </nav>
            <button className={styles.menuBtn} onClick={() => setIsDrawerOpen(true)} type="button">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="4" y1="12" x2="20" y2="12"></line>
                <line x1="4" y1="6" x2="20" y2="6"></line>
                <line x1="4" y1="18" x2="20" y2="18"></line>
              </svg>
            </button>
          </>
        )}
      </header>
      {isDrawerOpen && showNav && (
        <>
          <div className={styles.overlay} onClick={() => setIsDrawerOpen(false)} />
          <div className={styles.drawer}>
            <button className={styles.closeBtn} onClick={() => setIsDrawerOpen(false)} type="button">✕</button>
            <nav className={styles.mobileNav}>
              <button className={styles.navLink} type="button">Dashboard</button>
              {onLogout && <button onClick={() => { onLogout(); setIsDrawerOpen(false); }} className={styles.navLink} type="button">Sign Out</button>}
            </nav>
          </div>
        </>
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
};
