import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeId = 'classic' | 'dlc-labs';
type ThemeContextValue = { theme: ThemeId; setTheme: (theme: ThemeId) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

// The DLC × dubizzleLabs theme is the default. Only an explicit pick from the
// switch is stored; the old "dlc-theme" key was written on every visit, so it
// is ignored rather than read as a choice.
const STORAGE_KEY = 'dlc-theme-choice';

function readTheme(): ThemeId {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'classic' ? 'classic' : 'dlc-labs';
  } catch {
    return 'dlc-labs';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const value = useMemo(
    () => ({
      theme,
      setTheme: (next: ThemeId) => {
        setThemeState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // The theme remains switchable for this session when storage is unavailable.
        }
      },
    }),
    [theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}

/** Header pill that flips between the classic and DLC × dubizzleLabs themes. */
export function ThemeSwitch({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      className={`theme-switch hud rounded-full border border-line px-2.5 py-1 text-[10px] text-muted transition hover:text-ink ${className}`}
      aria-label={`Switch to ${theme === 'classic' ? 'DLC × dubizzleLabs' : 'classic'} theme`}
      title="Preview themes"
      onClick={() => setTheme(theme === 'classic' ? 'dlc-labs' : 'classic')}
    >
      {theme === 'classic' ? 'CLASSIC' : 'DLC × LABS'}
    </button>
  );
}
