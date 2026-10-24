import {
  ApprovalDecisionRequest,
  BenchmarkParams,
  BenchmarkRunResponse,
  CustomScenarioParams,
  Event,
  HealthResponse,
  IncidentResponse,
  IncidentStartResponse,
  IncidentSummaryItem,
  ScenariosResponse,
} from '../types';

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  'http://127.0.0.1:8000';

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`API Error ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || JSON.stringify(body);
      } catch {
        // use statusText
      }
      throw new ApiError(res.status, detail);
    }

    return (await res.json()) as T;
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(0, err.message || 'Network connection failed');
  }
}

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export async function fetchScenarios(): Promise<ScenariosResponse> {
  return request<ScenariosResponse>('/scenarios');
}

export async function fetchIncidents(limit = 50): Promise<IncidentSummaryItem[]> {
  const data = await request<{ incidents: IncidentSummaryItem[] }>(`/incidents?limit=${limit}`);
  return data.incidents || [];
}

export async function fetchIncident(incidentId: string): Promise<IncidentResponse> {
  return request<IncidentResponse>(`/incidents/${encodeURIComponent(incidentId)}`);
}

export async function fetchInvestigation(incidentId: string): Promise<Record<string, any>> {
  return request<Record<string, any>>(`/incidents/${encodeURIComponent(incidentId)}/investigation`);
}

export async function startIncident(
  scenario: string,
  client: string,
  mode: string = 'proofloop',
  customParams?: CustomScenarioParams
): Promise<IncidentStartResponse> {
  const payload: Record<string, any> = { scenario, client, mode };
  if (customParams) {
    payload.custom_params = customParams;
  }
  return request<IncidentStartResponse>('/incidents/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function submitApproval(
  incidentId: string,
  requestPayload: ApprovalDecisionRequest
): Promise<IncidentResponse> {
  return request<IncidentResponse>(
    `/incidents/${encodeURIComponent(incidentId)}/approval`,
    {
      method: 'POST',
      body: JSON.stringify(requestPayload),
    }
  );
}

export async function startBenchmark(params: BenchmarkParams): Promise<BenchmarkRunResponse> {
  return request<BenchmarkRunResponse>('/benchmark', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function fetchBenchmark(runId: string): Promise<BenchmarkRunResponse> {
  return request<BenchmarkRunResponse>(`/benchmark/${encodeURIComponent(runId)}`);
}

export interface SseSubscription {
  close: () => void;
}

export function subscribeToEvents(
  incidentId: string,
  handlers: {
    onEvent: (event: Event) => void;
    onError?: (err: globalThis.Event) => void;
    onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'completed') => void;
  },
  initialAfter = 0
): SseSubscription {
  let activeCursor = initialAfter;
  let eventSource: EventSource | null = null;
  let isClosed = false;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  const seenEventIds = new Set<string>();

  function connect() {
    if (isClosed) return;
    handlers.onStatusChange?.('connecting');

    const sseUrl = `${API_BASE_URL}/incidents/${encodeURIComponent(incidentId)}/events?after=${activeCursor}`;
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      if (isClosed) return;
      handlers.onStatusChange?.('connected');
    };

    eventSource.onmessage = (messageEvent) => {
      if (isClosed) return;
      try {
        const raw = JSON.parse(messageEvent.data);
        const sequence = raw.sequence ?? (messageEvent.lastEventId ? parseInt(messageEvent.lastEventId, 10) : undefined);
        if (typeof sequence === 'number' && !isNaN(sequence) && sequence > activeCursor) {
          activeCursor = sequence;
        }

        // Suppress duplicate events by event_id
        if (raw.event_id) {
          if (seenEventIds.has(raw.event_id)) {
            return;
          }
          seenEventIds.add(raw.event_id);
        }

        const parsedEvent: Event = {
          sequence: sequence ?? raw.sequence,
          event_id: raw.event_id || `seq-${sequence}`,
          incident_id: raw.incident_id || incidentId,
          timestamp: raw.timestamp || new Date().toISOString(),
          type: raw.type || messageEvent.type || 'message',
          actor: raw.actor || 'system',
          payload: raw.payload || {},
          evidence_refs: raw.evidence_refs || [],
        };

        handlers.onEvent(parsedEvent);

        if (parsedEvent.type === 'outcome') {
          const outcome = parsedEvent.payload?.outcome;
          if (outcome && outcome !== 'RUNNING' && outcome !== 'PENDING_APPROVAL') {
            handlers.onStatusChange?.('completed');
          }
        }
      } catch (e) {
        console.warn('Failed to parse SSE event data', e);
      }
    };

    // Also register explicit event types
    const eventTypes = [
      'incident_opened',
      'evidence_collected',
      'injection_detected',
      'action_proposed',
      'policy_decision',
      'approval_requested',
      'human_approval_decision',
      'approval_rejected_by_policy',
      'tool_executed',
      'verification_check',
      'verification_result',
      'investigation_limit_reached',
      'outcome',
      'worker_error',
    ];

    eventTypes.forEach((type) => {
      eventSource?.addEventListener(type, (customEvent: MessageEvent) => {
        if (isClosed) return;
        try {
          const raw = JSON.parse(customEvent.data);
          const sequence = raw.sequence ?? (customEvent.lastEventId ? parseInt(customEvent.lastEventId, 10) : undefined);
          if (typeof sequence === 'number' && !isNaN(sequence) && sequence > activeCursor) {
            activeCursor = sequence;
          }

          if (raw.event_id) {
            if (seenEventIds.has(raw.event_id)) return;
            seenEventIds.add(raw.event_id);
          }

          const parsed: Event = {
            sequence: sequence ?? raw.sequence,
            event_id: raw.event_id || `seq-${sequence}`,
            incident_id: raw.incident_id || incidentId,
            timestamp: raw.timestamp || new Date().toISOString(),
            type: type,
            actor: raw.actor || 'system',
            payload: raw.payload || {},
            evidence_refs: raw.evidence_refs || [],
          };

          handlers.onEvent(parsed);

          if (type === 'outcome') {
            const outcome = parsed.payload?.outcome;
            if (outcome && outcome !== 'RUNNING' && outcome !== 'PENDING_APPROVAL') {
              handlers.onStatusChange?.('completed');
            }
          }
        } catch (e) {
          console.warn(`Failed to parse custom SSE event ${type}`, e);
        }
      });
    });

    eventSource.onerror = (err) => {
      if (isClosed) return;
      handlers.onStatusChange?.('disconnected');
      handlers.onError?.(err);

      // Clean up failed source and reconnect after 1.5s backoff with last cursor
      eventSource?.close();
      eventSource = null;

      if (!isClosed) {
        reconnectTimeout = setTimeout(() => {
          connect();
        }, 1500);
      }
    };
  }

  connect();

  return {
    close: () => {
      isClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      handlers.onStatusChange?.('disconnected');
    },
  };
}
