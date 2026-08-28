'use client';

import React, { useId } from 'react';
import { cn } from '@/lib/utils';

interface FieldProps {
    label: string;
    /** Rendered under the label — say what the setting does, not what it is. */
    hint?: string;
    children: (id: string) => React.ReactNode;
    className?: string;
}

/**
 * One labelled setting inside a block body. Owns the label/control
 * association so every control in the editor is reachable by its label.
 */
export function Field({ label, hint, children, className }: FieldProps) {
    const id = useId();

    return (
        <div className={cn('space-y-2', className)}>
            <label htmlFor={id} className="block text-xs font-medium text-foreground">
                {label}
            </label>
            {hint && <p className="text-xs leading-4 text-muted-foreground">{hint}</p>}
            {children(id)}
        </div>
    );
}

interface ChoiceRowProps {
    /** Accessible name for the group — visually carried by the Field label. */
    label: string;
    options: readonly string[];
    value: string;
    /** Presentation for an option whose stored value is not what to show. */
    renderLabel?: (option: string) => string;
    onChange: (value: string) => void;
}

/**
 * A row of chips standing in for a select when the options are few and short.
 * Arrow keys move between chips; the whole row is one tab stop.
 */
export function ChoiceRow({ label, options, value, renderLabel, onChange }: ChoiceRowProps) {
    const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

    const onKeyDown = (event: React.KeyboardEvent, index: number) => {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        if (!forward && !back) return;

        event.preventDefault();
        const next = forward
            ? (index + 1) % options.length
            : (index - 1 + options.length) % options.length;
        refs.current[next]?.focus();
        onChange(options[next]);
    };

    return (
        <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
            {options.map((option, index) => {
                const selected = value === option;
                return (
                    <button
                        key={option}
                        ref={(node) => {
                            refs.current[index] = node;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected || (!options.includes(value) && index === 0) ? 0 : -1}
                        onClick={() => onChange(option)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={cn(
                            'inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium',
                            'transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                            selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-transparent text-muted-foreground hover:border-border-strong hover:text-foreground'
                        )}
                    >
                        {renderLabel ? renderLabel(option) : option}
                    </button>
                );
            })}
        </div>
    );
}

interface StepperProps {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** Renders the number the way the user thinks about it. */
    format?: (value: number) => string;
    onChange: (value: number) => void;
}

/** A numeric setting as a slider, with the value shown in tabular figures. */
export function Stepper({ id, label, value, min, max, step, format, onChange }: StepperProps) {
    return (
        <div className="flex items-center gap-4">
            <input
                id={id}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                aria-label={label}
                onChange={(event) => onChange(Number(event.target.value))}
                className="h-11 flex-1 cursor-pointer accent-primary"
            />
            <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {format ? format(value) : value}
            </span>
        </div>
    );
}
