import React, { createContext, useContext, useEffect, useState } from 'react';
import { ThemeMode } from '../types/wallet';

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>('haptix-dark');

  useEffect(() => {
    // Initial load from storage
    const loadTheme = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const res = await chrome.storage.local.get(['haptix_theme']);
          if (res.haptix_theme === 'light' || res.haptix_theme === 'haptix-light') {
            setTheme('haptix-light');
            document.documentElement.setAttribute('data-theme', 'haptix-light');
            return;
          }
        } else {
          const saved = localStorage.getItem('haptix_theme');
          if (saved === 'light' || saved === 'haptix-light') {
            setTheme('haptix-light');
            document.documentElement.setAttribute('data-theme', 'haptix-light');
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to load theme preference', e);
      }
      setTheme('haptix-dark');
      document.documentElement.setAttribute('data-theme', 'haptix-dark');
    };

    loadTheme();
  }, []);

  const toggleTheme = async () => {
    const nextTheme: ThemeMode = theme === 'haptix-dark' ? 'haptix-light' : 'haptix-dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);

    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ haptix_theme: nextTheme === 'haptix-light' ? 'light' : 'dark' });
      } else {
        localStorage.setItem('haptix_theme', nextTheme === 'haptix-light' ? 'light' : 'dark');
      }
    } catch (e) {
      console.warn('Failed to save theme', e);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'haptix-dark' }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
