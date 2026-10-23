import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeToEvents } from '../api/client';
import { Event } from '../types';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  listeners: Map<string, ((event: MessageEvent) => void)[]> = new Map();
  readyState: number = 0; // 0 = CONNECTING, 1 = OPEN, 2 = CLOSED

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((l) => l !== listener)
    );
  }

  close() {
    this.readyState = 2;
  }

  // Test simulation helpers
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.(new globalThis.Event('open'));
  }

  simulateMessage(data: any, lastEventId?: string) {
    const msg = new MessageEvent('message', {
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId,
    });
    this.onmessage?.(msg);
  }

  simulateCustomEvent(type: string, data: any, lastEventId?: string) {
    const msg = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId,
    });
    const handlers = this.listeners.get(type) || [];
    handlers.forEach((h) => h(msg));
  }

  simulateError() {
    this.onerror?.(new globalThis.Event('error'));
  }
}

describe('SSE Event Stream Subscription (client.ts)', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.useFakeTimers();
    // @ts-ignore
    globalThis.EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.EventSource = originalEventSource;
  });

  it('connects to backend events endpoint with numeric cursor and fires status changes', () => {
    const receivedEvents: Event[] = [];
    const statuses: string[] = [];

    const sub = subscribeToEvents(
      'inc-test-001',
      {
        onEvent: (evt) => receivedEvents.push(evt),
        onStatusChange: (status) => statuses.push(status),
      },
      0
    );

    expect(MockEventSource.instances.length).toBe(1);
    const instance = MockEventSource.instances[0];
    expect(instance.url).toContain('/incidents/inc-test-001/events?after=0');
    expect(statuses).toEqual(['connecting']);

    instance.simulateOpen();
    expect(statuses).toEqual(['connecting', 'connected']);

    // Emit event
    instance.simulateMessage({
      sequence: 1,
      event_id: 'evt-001',
      incident_id: 'inc-test-001',
      type: 'incident_opened',
      actor: 'system',
      payload: { scenario: 'clean_recovery' },
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].sequence).toBe(1);
    expect(receivedEvents[0].event_id).toBe('evt-001');

    sub.close();
    expect(instance.readyState).toBe(2);
    expect(statuses).toContain('disconnected');
  });

  it('suppresses duplicate events with identical event_id', () => {
    const receivedEvents: Event[] = [];

    const sub = subscribeToEvents(
      'inc-test-002',
      {
        onEvent: (evt) => receivedEvents.push(evt),
      },
      0
    );

    const instance = MockEventSource.instances[0];
    instance.simulateOpen();

    const eventPayload = {
      sequence: 5,
      event_id: 'evt-dedup-unique',
      incident_id: 'inc-test-002',
      type: 'evidence_collected',
      actor: 'system',
      payload: { key: 'error_rate', value: 0.8 },
    };

    // Send the exact same event three times (e.g. across reconnect or replay)
    instance.simulateMessage(eventPayload);
    instance.simulateMessage(eventPayload);
    instance.simulateMessage(eventPayload);

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].event_id).toBe('evt-dedup-unique');

    sub.close();
  });

  it('reconnects with updated numeric cursor after disconnect/error', () => {
    const receivedEvents: Event[] = [];
    const statuses: string[] = [];

    const sub = subscribeToEvents(
      'inc-test-003',
      {
        onEvent: (evt) => receivedEvents.push(evt),
        onStatusChange: (status) => statuses.push(status),
      },
      0
    );

    const firstSource = MockEventSource.instances[0];
    firstSource.simulateOpen();

    // Receive event seq 12
    firstSource.simulateMessage({
      sequence: 12,
      event_id: 'evt-012',
      incident_id: 'inc-test-003',
      type: 'policy_decision',
      actor: 'policy_gate',
      payload: { decision: 'ALLOW' },
    });

    expect(receivedEvents.length).toBe(1);

    // Simulate network error
    firstSource.simulateError();
    expect(statuses).toContain('disconnected');

    // Advance timer past backoff (1500ms)
    vi.advanceTimersByTime(1600);

    // A second EventSource should have been instantiated with after=12
    expect(MockEventSource.instances.length).toBe(2);
    const secondSource = MockEventSource.instances[1];
    expect(secondSource.url).toContain('/incidents/inc-test-003/events?after=12');

    sub.close();
  });

  it('marks stream completed when terminal outcome event arrives', () => {
    const statuses: string[] = [];

    const sub = subscribeToEvents(
      'inc-test-004',
      {
        onEvent: () => {},
        onStatusChange: (status) => statuses.push(status),
      },
      0
    );

    const instance = MockEventSource.instances[0];
    instance.simulateOpen();

    // Non-terminal outcome: PENDING_APPROVAL - should NOT mark completed
    instance.simulateCustomEvent('outcome', {
      sequence: 3,
      event_id: 'evt-outcome-pending',
      type: 'outcome',
      actor: 'system',
      payload: { outcome: 'PENDING_APPROVAL' },
    });

    expect(statuses).not.toContain('completed');

    // Terminal outcome: VERIFIED
    instance.simulateCustomEvent('outcome', {
      sequence: 4,
      event_id: 'evt-outcome-verified',
      type: 'outcome',
      actor: 'system',
      payload: { outcome: 'VERIFIED' },
    });

    expect(statuses).toContain('completed');

    sub.close();
  });
});
