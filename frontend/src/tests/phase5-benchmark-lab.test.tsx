import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BenchmarkView } from '../components/BenchmarkView';

describe('BenchmarkView — Phase 5 Real-Dataset Evaluation Lab Integration', () => {
  it('renders tab selector distinguishing synthetic simulator benchmark from real-dataset evaluation', () => {
    render(<BenchmarkView />);

    const syntheticTab = screen.getByRole('tab', { name: /01 Synthetic Simulator Benchmark/i });
    const datasetTab = screen.getByRole('tab', { name: /02 Real-Dataset Diagnosis Evaluation/i });

    expect(syntheticTab).toBeInTheDocument();
    expect(datasetTab).toBeInTheDocument();

    // Default active is synthetic simulator
    expect(screen.getByText('Scripted Baseline vs ProofLoop Benchmark Runner')).toBeInTheDocument();
  });

  it('switches to Phase 5 Real-Dataset Evaluation view with clear development boundaries', () => {
    render(<BenchmarkView />);

    const datasetTab = screen.getByRole('tab', { name: /02 Real-Dataset Diagnosis Evaluation/i });
    fireEvent.click(datasetTab);

    expect(screen.getByTestId('real-dataset-eval-panel')).toBeInTheDocument();
    expect(screen.getByText('Phase 5 Real-Dataset Evaluation Engine')).toBeInTheDocument();
    expect(screen.getByText('BACKEND IN DEVELOPMENT')).toBeInTheDocument();
    expect(screen.getAllByText(/Cloud-OpsBench/i).length).toBeGreaterThanOrEqual(1);
  });

  it('toggles developer preview fixture with explicit warning label', () => {
    render(<BenchmarkView />);

    const datasetTab = screen.getByRole('tab', { name: /02 Real-Dataset Diagnosis Evaluation/i });
    fireEvent.click(datasetTab);

    const toggleBtn = screen.getByRole('button', { name: /INSPECT DEVELOPMENT FIXTURE/i });
    fireEvent.click(toggleBtn);

    expect(
      screen.getByText(/⚠️ \[DEVELOPMENT PREVIEW FIXTURE — NOT PRODUCTION EVALUATION DATA\]/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Top-1 Accuracy')).toBeInTheDocument();
    expect(screen.getByText('Top-3 Accuracy')).toBeInTheDocument();
  });
});
