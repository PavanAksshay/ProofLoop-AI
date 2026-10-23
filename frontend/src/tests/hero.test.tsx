import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProofLoopHero } from '../components/ProofLoopHero';
import { Component as AeroHero3Component } from '../components/ui/aero-hero-3';
import DemoHero from '../components/ui/demo';

describe('Hero Components', () => {
  it('renders ProofLoopHero with 12-column architectural overlay and launch button', () => {
    const onStartMock = vi.fn();
    const onBenchmarkMock = vi.fn();

    render(
      <ProofLoopHero
        activeView="operations"
        onStartClick={onStartMock}
        onBenchmarkClick={onBenchmarkMock}
      />
    );

    expect(screen.queryByText(/PROOFLOOP AI \/\/ AGENTOPS INCIDENT GOVERNANCE/i)).not.toBeInTheDocument();
    expect(screen.getByText('POLICY-GOVERNED INCIDENT RESOLUTION')).toBeInTheDocument();
    expect(screen.getByText('LAUNCH SIMULATION')).toBeInTheDocument();
    expect(screen.getByText('0 MUTATIONS')).toBeInTheDocument();
    expect(screen.getByText('3-CHECK PROBES')).toBeInTheDocument();

    const launchBtn = screen.getByRole('button', { name: /LAUNCH SIMULATION/i });
    fireEvent.click(launchBtn);
    expect(onStartMock).toHaveBeenCalled();
  });

  it('renders aero-hero-3 counter component correctly', () => {
    render(<AeroHero3Component />);

    expect(screen.getByText('Component Example')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();

    const plusBtn = screen.getByRole('button', { name: '+' });
    fireEvent.click(plusBtn);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders 21st.dev demo hero without crashing', () => {
    render(<DemoHero />);

    expect(screen.getByText('Sustainable Solutions for a Better Future')).toBeInTheDocument();
    expect(screen.getByText('Start a Project')).toBeInTheDocument();
  });
});
