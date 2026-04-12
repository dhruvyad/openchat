'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    if (!mounted) {
        return <div className="w-8 h-8" />;
    }

    const next =
        theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';

    const Icon =
        theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

    return (
        <button
            type="button"
            onClick={() => setTheme(next)}
            className="flex items-center justify-center w-8 h-8 rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted transition-colors"
            title={`Theme: ${theme} (click for ${next})`}
        >
            <Icon className="w-4 h-4" />
        </button>
    );
}
