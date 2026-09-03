'use client';

/**
 * The Crewser tab.
 *
 * Crewser is the second way to run an agent: instead of the extension driving
 * the user's Chrome, a separate agent-friendly browser sits beside it. The panel
 * is deliberately small — it installs nothing itself and configures nothing. It
 * reports one fact (is the browser there) and offers one action (open it), and
 * everything else is a link out.
 *
 * The launch cannot happen in the page — browsers do not let a website start a
 * native app — so the button calls `/api/crewser`, which is the dev server on
 * this same machine. That route refuses to run on a hosted deploy, which is why
 * this panel can end up in a "cannot launch here" state that is not an error.
 */

import React from 'react';
import { Globe, Play, Check, Loader2, AlertTriangle, Copy, ExternalLink, Puzzle } from 'lucide-react';

interface CrewserStatus {
    supported: boolean;
    canLaunch: boolean;
    installed: boolean;
    running: boolean;
    appPath: string | null;
    installDir: string;
    version: string | null;
}

/** Pure read of the status route. Returns null for "could not reach it at all". */
async function fetchStatus(): Promise<CrewserStatus | null> {
    try {
        const res = await fetch('/api/crewser', { cache: 'no-store' });
        return (await res.json()) as CrewserStatus;
    } catch {
        return null;
    }
}

const MOTION = 'transition-all duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]';
const FOCUS =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export default function CrewserPanel() {
    const [status, setStatus] = React.useState<CrewserStatus | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [launching, setLaunching] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [copied, setCopied] = React.useState(false);

    /** Applies whatever `fetchStatus` came back with, including the failure. */
    const apply = React.useCallback((next: CrewserStatus | null) => {
        if (next) {
            setStatus(next);
            setError(null);
        } else {
            setError('Could not reach the local server.');
        }
        setLoading(false);
    }, []);

    const refresh = React.useCallback(async () => {
        apply(await fetchStatus());
    }, [apply]);

    React.useEffect(() => {
        // Settling in the promise callback, guarded against an unmount, keeps the
        // first load off the render path.
        let alive = true;
        fetchStatus().then((next) => {
            if (alive) apply(next);
        });
        return () => {
            alive = false;
        };
    }, [apply]);

    const handleLaunch = async () => {
        setLaunching(true);
        setError(null);
        try {
            const res = await fetch('/api/crewser', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) setError(data.error ?? 'Could not launch Crewser.');
            // The process takes a moment to show up in pgrep.
            setTimeout(refresh, 1200);
        } catch {
            setError('Could not reach the local server.');
        } finally {
            setLaunching(false);
        }
    };

    const installCmd = status ? `cd "${status.installDir}" && ./install.sh` : '';

    const handleCopy = async () => {
        await navigator.clipboard.writeText(installCmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    return (
        <div className="p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                        <Globe className="w-7 h-7 text-muted-foreground" aria-hidden="true" />
                        Crewser
                    </h1>
                    <p className="text-muted-foreground mt-2 max-w-xl">
                        A second browser that sits beside Chrome, built for agents to drive. Use it
                        when you want a task to run somewhere other than your everyday windows.
                    </p>
                </div>
            </div>

            {/* ---------------------------------------------------------- status -- */}
            <section
                className="rounded-2xl bg-elevated shadow-e1 p-6 mb-6"
                aria-labelledby="crewser-status-heading"
            >
                <h2 id="crewser-status-heading" className="sr-only">
                    Crewser status
                </h2>

                {loading ? (
                    <div className="flex items-center gap-3 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Checking for Crewser…</span>
                    </div>
                ) : !status?.supported ? (
                    <StatusRow
                        tone="warning"
                        title="macOS only, for now"
                        body="The Crewser build we pin is a macOS app. On Linux or Windows, grab a build from the BrowserOS releases page and point CREWSER_APP_PATH at it."
                    />
                ) : !status.installed ? (
                    <div className="space-y-5">
                        <StatusRow
                            tone="warning"
                            title="Not installed yet"
                            body="Crewser is a 147 MB browser that lives outside git. One command installs it into this repo."
                        />
                        <div className="rounded-xl bg-background border border-border p-4">
                            <div className="flex items-start justify-between gap-4">
                                <code className="text-sm text-zinc-300 font-mono break-all leading-relaxed">
                                    {installCmd}
                                </code>
                                <button
                                    onClick={handleCopy}
                                    className={`shrink-0 flex items-center gap-2 px-3 py-2 min-h-11 rounded-lg text-sm font-medium text-muted-foreground hover:text-zinc-100 hover:bg-white/6 ${MOTION} ${FOCUS}`}
                                >
                                    {copied ? (
                                        <Check className="w-4 h-4 text-success" aria-hidden="true" />
                                    ) : (
                                        <Copy className="w-4 h-4" aria-hidden="true" />
                                    )}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                        </div>
                        <button
                            onClick={refresh}
                            className={`text-sm font-semibold text-muted-foreground hover:text-zinc-100 ${MOTION} ${FOCUS} rounded-lg px-2 py-1`}
                        >
                            Check again
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                        <StatusRow
                            tone={status.running ? 'success' : 'idle'}
                            title={status.running ? 'Crewser is running' : 'Crewser is installed'}
                            body={
                                status.version
                                    ? `Version ${status.version} · ${status.appPath}`
                                    : (status.appPath ?? '')
                            }
                        />
                        <button
                            onClick={handleLaunch}
                            disabled={launching || !status.canLaunch}
                            className={`shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-11 rounded-full text-sm font-semibold bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 ${MOTION} ${FOCUS}`}
                        >
                            {launching ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            ) : (
                                <Play className="w-4 h-4" aria-hidden="true" />
                            )}
                            {launching
                                ? 'Opening…'
                                : status.running
                                  ? 'Bring to front'
                                  : 'Open Crewser'}
                        </button>
                    </div>
                )}

                {status && status.installed && !status.canLaunch && (
                    <p className="mt-5 text-sm text-muted-foreground border-t border-border pt-4">
                        Opening an app only works from a dev server on your own machine — a hosted
                        page cannot reach your desktop. Launch it from the Applications folder
                        instead.
                    </p>
                )}

                {error && (
                    <p
                        role="alert"
                        className="mt-5 text-sm text-danger flex items-start gap-2 border-t border-border pt-4"
                    >
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                        {error}
                    </p>
                )}
            </section>

            {/* ------------------------------------------------- two ways to run -- */}
            <section aria-labelledby="crewser-choice-heading">
                <h2
                    id="crewser-choice-heading"
                    className="text-sm font-semibold text-zinc-300 mb-3"
                >
                    Two ways to run an agent
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    <WayCard
                        icon={Puzzle}
                        title="The extension"
                        body="Drives the Chrome you are already in, with the sessions you are already logged into. Best for anything involving your own accounts."
                    />
                    <WayCard
                        icon={Globe}
                        title="Crewser"
                        body="A separate browser with its own profile, kept out of your everyday windows. Best for long tasks you would rather not watch take over your tabs."
                    />
                </div>
                <p className="text-sm text-muted-foreground mt-5 leading-relaxed">
                    Crewser is a pinned build of{' '}
                    <a
                        href="https://github.com/browseros-ai/BrowserOS"
                        target="_blank"
                        rel="noreferrer"
                        className={`text-zinc-300 underline underline-offset-4 hover:text-white inline-flex items-center gap-1 ${MOTION} ${FOCUS} rounded`}
                    >
                        BrowserOS
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>{' '}
                    (AGPL-3.0), installed unmodified. It carries its own agent and its own model
                    settings — point it at the same OpenRouter or Gemini key you use here.
                </p>
            </section>
        </div>
    );
}

/* ------------------------------------------------------------------ parts -- */

function StatusRow({
    tone,
    title,
    body,
}: {
    tone: 'success' | 'warning' | 'idle';
    title: string;
    body: string;
}) {
    const dot =
        tone === 'success'
            ? 'bg-success'
            : tone === 'warning'
              ? 'bg-warning'
              : 'bg-muted-foreground';

    return (
        <div className="flex items-start gap-3 min-w-0">
            <span
                className={`w-2 h-2 rounded-full mt-2 shrink-0 ${dot}`}
                aria-hidden="true"
            />
            <div className="min-w-0">
                <p className="text-white font-semibold">{title}</p>
                {body && (
                    <p className="text-sm text-muted-foreground mt-1 break-all">{body}</p>
                )}
            </div>
        </div>
    );
}

function WayCard({
    icon: Icon,
    title,
    body,
}: {
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    title: string;
    body: string;
}) {
    return (
        <div className="rounded-2xl bg-elevated shadow-e1 p-5">
            <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4 text-muted-foreground" aria-hidden={true} />
                <h3 className="text-white font-semibold text-sm">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        </div>
    );
}
