import { Poller } from '../poller';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Poller', () => {
  it('should fire an immediate poll on start', async () => {
    const fetchFn = jest.fn().mockResolvedValue('data');
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 60_000 });
    const listener = jest.fn();
    poller.onDidPoll(listener);

    poller.start();
    // Flush the immediate microtask
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('data');

    poller.dispose();
  });

  it('should poll again after the interval', async () => {
    const fetchFn = jest.fn().mockResolvedValue('tick');
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 1_000 });
    const listener = jest.fn();
    poller.onDidPoll(listener);

    poller.start();
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(2);

    poller.dispose();
  });

  it('should not start twice', async () => {
    const fetchFn = jest.fn().mockResolvedValue(null);
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 1_000 });

    poller.start();
    poller.start();
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(1);

    poller.dispose();
  });

  it('should stop polling', async () => {
    const fetchFn = jest.fn().mockResolvedValue(null);
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 1_000 });

    poller.start();
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    poller.stop();
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(1);

    poller.dispose();
  });

  it('should skip a tick if the previous fetch is still inflight', async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchFn = jest.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = () => resolve('done');
        }),
    );
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 1_000 });

    poller.start();
    // First fetch is now inflight (unresolved)

    jest.advanceTimersByTime(1_000);
    // Second tick should be skipped because first is still inflight

    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Resolve the first fetch
    resolveFetch?.();
    await Promise.resolve();

    // Now the next tick should work
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(2);

    poller.dispose();
  });

  it('should not crash when fetchFn throws', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('boom'));
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 1_000 });
    const listener = jest.fn();
    poller.onDidPoll(listener);

    poller.start();
    await Promise.resolve();

    // Should not have fired the event
    expect(listener).not.toHaveBeenCalled();

    // Should recover and poll again on next tick
    fetchFn.mockResolvedValue('recovered');
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith('recovered');

    poller.dispose();
  });

  it('should trigger a manual poll via pollNow', async () => {
    const fetchFn = jest.fn().mockResolvedValue('manual');
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 60_000 });
    const listener = jest.fn();
    poller.onDidPoll(listener);

    await poller.pollNow();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('manual');

    poller.dispose();
  });

  it('should clean up on dispose', async () => {
    const fetchFn = jest.fn().mockResolvedValue(null);
    const poller = new Poller({ label: 'test', fetchFn, intervalMs: 1_000 });

    poller.start();
    await Promise.resolve();

    poller.dispose();
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();

    // Only the initial fetch, no more after dispose
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
