import { clearRawLog, flushRawLog, getRawLogSnapshot, MAX_RAW_RECORDS, RAW_LOG_FLUSH_MS, setupRawLifecycleLogging, writeRawLog } from './rawLog';
const KEY = 'taxi_raw_log_v1';
let storage;
const writes = () => storage.mock.calls.filter(([key]) => key === KEY);
beforeEach(() => { jest.useFakeTimers(); clearRawLog(); storage = jest.spyOn(Storage.prototype, 'setItem'); });
afterEach(() => { flushRawLog(); storage.mockRestore(); jest.useRealTimers(); });
test('GPS/emulator bursts persist once while all records are immediately available for export', () => {
    for (let i = 0; i < 100; i++)
        writeRawLog('position', { sequence: i });
    expect(writes()).toHaveLength(0);
    jest.advanceTimersByTime(RAW_LOG_FLUSH_MS);
    expect(writes()).toHaveLength(1);
    expect(getRawLogSnapshot().entries).toHaveLength(100);
    expect(writes()).toHaveLength(1);
});
test('export flushes a pending burst, and clear cancels its old timer', () => {
    writeRawLog('before-export');
    expect(getRawLogSnapshot().entries[0].event).toBe('before-export');
    expect(writes()).toHaveLength(1);
    writeRawLog('before-clear');
    clearRawLog();
    jest.advanceTimersByTime(RAW_LOG_FLUSH_MS);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([]);
    expect(writes()).toHaveLength(2);
});
test('retention and credential redaction are preserved', () => {
    for (let i = 0; i < MAX_RAW_RECORDS + 5; i++)
        writeRawLog('position', { i, password: 'hidden', u_hash: 'hidden' });
    const entries = getRawLogSnapshot().entries;
    expect(entries).toHaveLength(MAX_RAW_RECORDS);
    expect(entries[0].payload).toEqual({ i: 5, password: '[hidden]', u_hash: '[hidden]' });
    expect(writes()).toHaveLength(1);
});
test('blocked persistence never throws or discards the in-memory export', () => {
    storage.mockImplementation(() => { throw new Error('quota'); });
    writeRawLog('position');
    expect(() => flushRawLog()).not.toThrow();
    expect(getRawLogSnapshot().entries).toHaveLength(1);
});
test('hidden/pagehide flush pending diagnostics without relying on beforeunload', () => {
    setupRawLifecycleLogging();
    flushRawLog();
    storage.mockClear();
    writeRawLog('last-position');
    window.dispatchEvent(new Event('pagehide'));
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(KEY)).slice(-1)[0].event).toBe('last-position');
});
