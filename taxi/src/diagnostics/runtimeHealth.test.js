import { writeRawLog } from '../tools/rawLog';
import { startRuntimeHealth, trackRuntimeResource, runtimeResourceCounts } from './runtimeHealth';
import { observeMapRenderer } from './mapRendererHealth';
jest.mock('../tools/rawLog', () => ({ writeRawLog: jest.fn() }));
let stop;
beforeEach(() => { jest.useFakeTimers(); sessionStorage.clear(); writeRawLog.mockClear(); });
afterEach(() => { stop?.(); stop = undefined; jest.useRealTimers(); });
test('one installation, bounded local checkpoint, and listener/timer cleanup', () => {
    stop = startRuntimeHealth();
    expect(startRuntimeHealth()).toBe(stop);
    const calls = writeRawLog.mock.calls.length;
    jest.advanceTimersByTime(120000);
    expect(writeRawLog.mock.calls).toHaveLength(calls);
    expect(sessionStorage.getItem('taxi_runtime_health_v1').length).toBeLessThan(2000);
    stop();
    writeRawLog.mockClear();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after dispose' }));
    expect(writeRawLog).not.toHaveBeenCalled();
});
test('records JS/rejection facts and unfinished previous activity without declaring a crash', () => {
    sessionStorage.setItem('taxi_runtime_health_v1', JSON.stringify({ state: 'active', at: 1, lastEvent: 'map.ready', resources: { 'map-renderer': 1 } }));
    stop = startRuntimeHealth();
    window.dispatchEvent(new ErrorEvent('error', { message: 'test failure', lineno: 8 }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: new Error('rejection') });
    window.dispatchEvent(rejection);
    expect(writeRawLog.mock.calls.map(c => c[0])).toEqual(['runtime.previous_active_session', 'runtime.started', 'runtime.error', 'runtime.unhandled_rejection']);
    const release = trackRuntimeResource('map-renderer');
    release();
    release();
    expect(runtimeResourceCounts()['map-renderer']).toBe(0);
});
test('20 map lifecycles release their listeners and context-loss callbacks', () => {
    stop = startRuntimeHealth();
    for (let i = 0; i < 20; i++) {
        const listeners = new Map(), renderer = { on: jest.fn((name, fn) => listeners.set(name, fn)), off: jest.fn((name) => listeners.delete(name)) }, fallback = jest.fn();
        const cleanup = observeMapRenderer(renderer, fallback);
        expect(runtimeResourceCounts()['map-renderer']).toBe(1);
        listeners.get('webglcontextlost')();
        cleanup();
        cleanup();
        jest.runOnlyPendingTimers();
        expect(fallback).not.toHaveBeenCalled();
        expect(listeners.size).toBe(0);
        expect(runtimeResourceCounts()['map-renderer']).toBe(0);
    }
});
test('context loss falls back after dispatch, renderer errors are bounded per instance', () => {
    stop = startRuntimeHealth();
    const listeners = new Map(), renderer = { on: (n, f) => listeners.set(n, f), off: (n) => listeners.delete(n) }, fallback = jest.fn();
    const cleanup = observeMapRenderer(renderer, fallback);
    try {
        for (let i = 0; i < 100; i++)
            listeners.get('error')({ error: new Error('tile') });
        listeners.get('webglcontextlost')();
        listeners.get('webglcontextlost')();
        expect(fallback).not.toHaveBeenCalled();
        jest.advanceTimersByTime(0);
        expect(fallback).toHaveBeenCalledTimes(1);
        expect(writeRawLog.mock.calls.filter(c => c[0] === 'map.renderer_error')).toHaveLength(1);
    }
    finally {
        cleanup();
    }
});
