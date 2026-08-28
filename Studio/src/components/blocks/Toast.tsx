'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToastMessage {
    text: string;
    tone: 'info' | 'error';
    /** Changing this restarts the dismiss timer for a repeated message. */
    key: number;
}

interface ToastProps {
    message: ToastMessage | null;
    onDismiss: () => void;
}

export default function Toast({ message, onDismiss }: ToastProps) {
    useEffect(() => {
        if (!message) return;
        const timer = window.setTimeout(onDismiss, message.tone === 'error' ? 6000 : 3500);
        return () => window.clearTimeout(timer);
    }, [message, onDismiss]);

    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
        >
            {message && (
                <div
                    key={message.key}
                    className={cn(
                        'animate-block-enter pointer-events-auto flex items-start gap-3 rounded-lg bg-elevated px-4 py-3 shadow-e3',
                        message.tone === 'error' && 'text-danger'
                    )}
                >
                    {message.tone === 'error' ? (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    ) : (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    )}

                    <p
                        className={cn(
                            'max-w-[52ch] text-sm leading-5',
                            message.tone === 'error' ? 'text-danger' : 'text-foreground'
                        )}
                    >
                        {message.text}
                    </p>

                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss"
                        className="-my-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-fg transition-colors duration-[120ms] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                        <X className="size-3.5" />
                    </button>
                </div>
            )}
        </div>
    );
}
