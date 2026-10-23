import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BenchmarkView } from '../components/BenchmarkView';
import * as clientModule from '../api/client';
import { BenchmarkResult, BenchmarkRunResponse } from '../types';

describe('BenchmarkView Component', () => {
  const mockBenchmarkResult: BenchmarkResult = {
    run_id: 'bench-test-12345',
    timestamp: '2026-10-23T12:00:00Z',
    software_revision: 'b30da4b',
    parameters: {
      scenarios: ['clean_recovery', 'false_green'],
      supported_scenarios_evaluated: ['clean_recovery', 'false_green'],
      client: 'client_a',
      trials_per_scenario: 2,
      seed: 42,
    },
    metrics: {
      baseline: {
        system: 'Baseline',
        total_runs: 4,
        verified_recovery_rate: {
          value: 0.0,
          numerator: 0,
          denominator: 4,
          metric_name: 'verified_recovery_rate',
          formula: '0 / 4',
          description: '',
        },
        false_success_rate: {
          value: 100.0,
          numerator: 2,
          denominator: 2,
          metric_name: 'false_success_rate',
          formula: '2 / 2',
          description: '',
        },
        unauthorized_mutations: {
          value: 0.0,
          numerator: 0,
          denominator: 4,
          metric_name: 'unauthorized_mutations',
          formula: '0 / 4',
          description: '',
        },
        avg_tool_calls: {
          value: 1.0,
          numerator: 4,
          denominator: 4,
          metric_name: 'avg_tool_calls',
          formula: '4 / 4',
          description: '',
        },
        avg_time_ms: {
          value: 0.5,
          numerator: 2,
          denominator: 4,
          metric_name: 'avg_time_ms',
          formula: '2ms / 4',
          description: '',
        },
        escalation_correctness: {
          value: 0.0,
          numerator: 0,
          denominator: 4,
          metric_name: 'escalation_correctness',
          formula: '0 / 4',
          description: '',
        },
      },
      proofloop: {
        system: 'ProofLoop AI',
        total_runs: 4,
        verified_recovery_rate: {
          value: 50.0,
          numerator: 2,
          denominator: 4,
          metric_name: 'verified_recovery_rate',
          formula: '2 / 4',
          description: '',
        },
        false_success_rate: {
          value: 0.0,
          numerator: 0,
          denominator: 2,
          metric_name: 'false_success_rate',
          formula: '0 / 2',
          description: '',
        },
        unauthorized_mutations: {
          value: 0.0,
          numerator: 0,
          denominator: 4,
          metric_name: 'unauthorized_mutations',
          formula: '0 / 4',
          description: '',
        },
        avg_tool_calls: {
          value: 1.5,
          numerator: 6,
          denominator: 4,
          metric_name: 'avg_tool_calls',
          formula: '6 / 4',
          description: '',
        },
        avg_time_ms: {
          value: 55.0,
          numerator: 220,
          denominator: 4,
          metric_name: 'avg_time_ms',
          formula: '220ms / 4',
          description: '',
        },
        escalation_correctness: {
          value: 100.0,
          numerator: 4,
          denominator: 4,
          metric_name: 'escalation_correctness',
          formula: '4 / 4',
          description: '',
        },
      },
    },
    per_scenario: {
      clean_recovery: {
        baseline: {
          verified_recovery_rate: { value: 0.0 } as any,
          false_success_rate: { value: 0.0 } as any,
        } as any,
        proofloop: {
          verified_recovery_rate: { value: 100.0 } as any,
          escalation_correctness: { numerator: 0 } as any,
        } as any,
        trials_count: 2,
      },
      false_green: {
        baseline: {
          verified_recovery_rate: { value: 0.0 } as any,
          false_success_rate: { value: 100.0 } as any,
        } as any,
        proofloop: {
          verified_recovery_rate: { value: 0.0 } as any,
          escalation_correctness: { numerator: 2 } as any,
        } as any,
        trials_count: 2,
      },
    },
    raw_trials: {
      baseline: [],
      proofloop: [],
    },
    skipped_scenarios: [],
    disclaimer: 'All measurements are derived from deterministic synthetic service simulations.',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders benchmark configuration controls and synthetic disclosure', () => {
    render(<BenchmarkView />);

    expect(screen.getByText(/Scripted Baseline vs ProofLoop Benchmark Runner/i)).toBeInTheDocument();
    expect(
      screen.getByText(/All trials, metrics, and outcomes are evaluated on isolated/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/EVALUATION SCENARIOS/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /▶ Run Benchmark/i })).toBeInTheDocument();
  });

  it('submits benchmark run and renders comparison table when completed', async () => {
    const mockResponse: BenchmarkRunResponse = {
      run_id: 'bench-test-12345',
      status: 'completed',
      benchmark_url: '/benchmark/bench-test-12345',
      result: mockBenchmarkResult,
    };

    vi.spyOn(clientModule, 'startBenchmark').mockResolvedValue(mockResponse);

    render(<BenchmarkView />);

    const runBtn = screen.getByRole('button', { name: /▶ Run Benchmark/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Run: bench-test-123/i)).toBeInTheDocument();
    });

    // Check key metrics rendered in cards and table
    expect(screen.getAllByText('VERIFIED RECOVERY RATE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('FALSE-SUCCESS RATE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('UNAUTHORIZED MUTATIONS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ESCALATION CORRECTNESS').length).toBeGreaterThanOrEqual(1);

    // Baseline false success rate 100%
    expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
    // ProofLoop false success rate 0%
    expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(1);
  });

  it('displays API error banner when benchmark start fails', async () => {
    vi.spyOn(clientModule, 'startBenchmark').mockRejectedValue(
      new Error('Connection to backend failed')
    );

    render(<BenchmarkView />);

    const runBtn = screen.getByRole('button', { name: /▶ Run Benchmark/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Connection to backend failed/i)).toBeInTheDocument();
    });
  });
});
