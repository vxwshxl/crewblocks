/**
 * Launching the Crewser browser from the dashboard.
 *
 * A web page cannot start a native application — that is a deliberate browser
 * sandbox, not an oversight. What makes this work is that in local development
 * the Next server and the browser are the same machine, so the *server* can do
 * what the page cannot.
 *
 * That is also exactly why this route is fenced off. A hosted deploy has no
 * business spawning processes, and on Vercel it could not reach the user's Mac
 * anyway, so the route refuses to run anywhere but a local dev server. The app
 * path is resolved here and never read from the request: there is no input to
 * this endpoint, so there is nothing to inject into.
 */

import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The app bundle `Crewser/install.sh` writes. */
const APP_DIR_NAME = 'Crewser';
const APP_BUNDLE = 'Crewser.app';

/**
 * True only for a dev server on the developer's own machine. `VERCEL` covers the
 * hosted case even when someone builds in production mode locally, and the
 * explicit opt-out lets a packaged desktop build turn this on deliberately.
 */
function isLocalDev(): boolean {
    if (process.env.CREWSER_ALLOW_LAUNCH === '1') return true;
    if (process.env.VERCEL || process.env.NETLIFY || process.env.AWS_REGION) return false;
    return process.env.NODE_ENV !== 'production';
}

/**
 * Walk up from the Next cwd (`Studio/`) looking for the sibling `Crewser` folder,
 * so this keeps working if the repo is nested or the dev server is started from
 * somewhere unexpected.
 */
function resolveAppPath(): string | null {
    const override = process.env.CREWSER_APP_PATH;
    if (override) return override;

    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, APP_DIR_NAME, APP_BUNDLE);
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/** Where install.sh would put it, whether or not it has been run yet. */
function expectedInstallDir(): string {
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
        if (existsSync(path.join(dir, APP_DIR_NAME, 'install.sh'))) {
            return path.join(dir, APP_DIR_NAME);
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return path.join(process.cwd(), '..', APP_DIR_NAME);
}

async function readVersion(appPath: string): Promise<string | null> {
    try {
        const plist = await readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
        // Info.plist is XML; the value element follows its key sibling.
        const match = plist.match(
            /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/
        );
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

async function isRunning(appPath: string): Promise<boolean> {
    try {
        // pgrep exits 1 when nothing matches, which execFile surfaces as a throw.
        await run('pgrep', ['-f', `${appPath}/Contents/MacOS/`]);
        return true;
    } catch {
        return false;
    }
}

/** Status for the dashboard panel: is it installed, is it already open. */
export async function GET() {
    const supported = process.platform === 'darwin';
    const local = isLocalDev();
    const appPath = resolveAppPath();
    const installed = Boolean(appPath);

    return NextResponse.json({
        supported,
        canLaunch: supported && local,
        installed,
        running: installed && appPath ? await isRunning(appPath) : false,
        appPath,
        installDir: expectedInstallDir(),
        version: installed && appPath ? await readVersion(appPath) : null,
    });
}

/** Open the browser. No request body is read, by design. */
export async function POST() {
    if (process.platform !== 'darwin') {
        return NextResponse.json(
            { error: 'Crewser is macOS-only for now.', code: 'UNSUPPORTED_PLATFORM' },
            { status: 400 }
        );
    }

    if (!isLocalDev()) {
        return NextResponse.json(
            {
                error: 'Crewser can only be launched from a local dev server, not a hosted deploy.',
                code: 'NOT_LOCAL',
            },
            { status: 403 }
        );
    }

    const appPath = resolveAppPath();
    if (!appPath) {
        return NextResponse.json(
            {
                error: 'Crewser is not installed yet. Run Crewser/install.sh first.',
                code: 'NOT_INSTALLED',
                installDir: expectedInstallDir(),
            },
            { status: 404 }
        );
    }

    try {
        // No shell, and a fixed argv — `open -a` brings it forward if it is
        // already running rather than starting a second copy.
        await run('open', ['-a', appPath]);
        return NextResponse.json({ ok: true, appPath });
    } catch (err) {
        return NextResponse.json(
            {
                error: err instanceof Error ? err.message : 'Could not launch Crewser.',
                code: 'LAUNCH_FAILED',
            },
            { status: 500 }
        );
    }
}
