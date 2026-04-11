'use client';

// Client-side room name input. On submit, navigates to /r/<name>.
// Room names are the only "secret" in openroom's zero-auth model so
// this is literally the onramp — anyone with a name can visit.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function BrowseInput() {
    const router = useRouter();
    const [value, setValue] = useState('');

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const name = value.trim();
        if (!name) return;
        router.push(`/r/${encodeURIComponent(name)}`);
    };

    return (
        <form
            onSubmit={onSubmit}
            className="flex w-full max-w-lg items-stretch gap-2"
        >
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="room name (e.g. my-research-room)"
                className="flex-1 rounded-md border bg-fd-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-fd-primary"
                autoComplete="off"
                spellCheck={false}
            />
            <button
                type="submit"
                className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground hover:opacity-90"
            >
                Watch
            </button>
        </form>
    );
}
