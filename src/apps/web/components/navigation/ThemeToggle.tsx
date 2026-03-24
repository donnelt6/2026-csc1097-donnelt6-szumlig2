'use client';

import { useState, useEffect } from 'react';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';

export function ThemeToggle({ compact }: { compact?: boolean } = {}) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const systemTheme = prefersDark ? 'dark' : 'light';
      setTheme(systemTheme);
      document.documentElement.setAttribute('data-theme', systemTheme);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        const newTheme = e.matches ? 'dark' : 'light';
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  if (!mounted) {
    return (
      <button
        className={`theme-toggle${compact ? ' theme-toggle--compact' : ''}`}
        aria-label="Toggle theme"
        disabled
      >
        <MoonIcon className="theme-toggle-icon" />
        {!compact && <span className="sidebar-item-text">Theme</span>}
      </button>
    );
  }

  return (
    <button
      className={`theme-toggle${compact ? ' theme-toggle--compact' : ''}`}
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <SunIcon className="theme-toggle-icon" />
      ) : (
        <MoonIcon className="theme-toggle-icon" />
      )}
      {!compact && <span className="sidebar-item-text">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
