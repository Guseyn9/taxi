import type { ITokens } from '../types/types';
const KEY = 'state.user.tokens';
const EPOCH = 'taxi.auth.revocation', SESSION_EPOCH = 'taxi.auth.session-epoch';
const RECOVERY_SESSION = 'taxi.auth.recovery-session';
let memoryEpoch = '0';
let memory: ITokens | null = null;
let recoverySession: string | null = null;
function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
    try {
        return window[kind];
    }
    catch {
        return null;
    }
}
function decode(raw: string | null): ITokens | null {
    if (!raw)
        return null;
    try {
        const value = JSON.parse(raw);
        if (value && typeof value.token === 'string' && value.token && typeof value.u_hash === 'string' && value.u_hash)
            return { token: value.token, u_hash: value.u_hash };
    }
    catch { /* Corrupt credentials are not an authenticated session. */ }
    return null;
}
function remove(store: Storage | null) { try {
    store?.removeItem(KEY);
}
catch { /* Storage may be unavailable. */ } }
function currentEpoch() { try {
    return storage('localStorage')?.getItem(EPOCH) || '0';
}
catch {
    return '0';
} }
function forget() { memory = null; recoverySession = null; remove(storage('sessionStorage')); remove(storage('localStorage')); try {
    storage('sessionStorage')?.removeItem(SESSION_EPOCH);
    storage('sessionStorage')?.removeItem(RECOVERY_SESSION);
}
catch { /* Unavailable storage. */ } }
export function subscribeSessionRevocation(listener: () => void): () => void {
    const handler = (event: StorageEvent) => { if (event.key !== EPOCH)
        return; forget(); listener(); };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
}
export function saveSessionTokens(tokens: ITokens): void {
    const safe = decode(JSON.stringify(tokens));
    if (!safe)
        throw new Error('Invalid session credentials');
    let previous = memory;
    try { previous = previous || decode(storage('sessionStorage')?.getItem(KEY) || null); } catch { /* Memory-only session. */ }
    const changed = previous?.token !== safe.token || previous?.u_hash !== safe.u_hash;
    if (changed) recoverySession = null;
    try {
        if (!changed) recoverySession = recoverySession || storage('sessionStorage')?.getItem(RECOVERY_SESSION) || null;
    } catch { /* Memory-only session. */ }
    // Non-secret session generation, never a credential or an authorization check.
    if (!recoverySession) recoverySession = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    memory = safe;
    memoryEpoch = currentEpoch();
    try {
        const session = storage('sessionStorage');
        session?.setItem(KEY, JSON.stringify(safe));
        session?.setItem(SESSION_EPOCH, memoryEpoch);
        session?.setItem(RECOVERY_SESSION, recoverySession);
    }
    catch {
        // A partial write must not restore the previous account on the next read.
        remove(storage('sessionStorage'));
        try { storage('sessionStorage')?.removeItem(RECOVERY_SESSION); } catch { /* Memory-only session. */ }
    }
    remove(storage('localStorage'));
}
/** Bind pending UI work to this exact login without persisting a token with it. */
export function getSessionRecoveryId(): string | null {
    if (memory) {
        if (memoryEpoch !== currentEpoch()) { forget(); return null; }
        return recoverySession;
    }
    return loadSessionTokens() ? recoverySession : null;
}
export function loadSessionTokens(): ITokens | null {
    const session = storage('sessionStorage'), legacy = storage('localStorage');
    let raw: string | null = null, old: string | null = null;
    try {
        raw = session?.getItem(KEY) || null;
        old = legacy?.getItem(KEY) || null;
    }
    catch { /* Use memory when blocked. */ }
    let savedEpoch = '0';
    try {
        savedEpoch = session?.getItem(SESSION_EPOCH) || '0';
    }
    catch { /* Fall back to in-memory epoch. */ }
    if ((memory && memoryEpoch !== currentEpoch()) || (!memory && raw && savedEpoch !== currentEpoch())) {
        forget();
        return null;
    }
    const tokens = memory || decode(raw) || decode(old);
    if (tokens)
        saveSessionTokens(tokens);
    else {
        remove(session);
        remove(legacy);
    }
    return tokens;
}
export function clearSessionTokens(broadcast = true): void {
    forget();
    if (!broadcast) return;
    // Non-secret generation invalidates opener/duplicated tabs, including after reload.
    try {
        storage('localStorage')?.setItem(EPOCH, `${Date.now()}-${Math.random()}`);
    }
    catch { /* Tab-local logout still succeeds. */ }
}
