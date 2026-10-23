import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IncidentLauncher } from '../components/IncidentLauncher';

describe('IncidentLauncher Component', () => {
  const mockScenarios = {
    scenarios: ['clean_recovery', 'false_green', 'stale_runbook', 'hostile_log'],
    clients: ['client_a', 'client_b'],
    modes: ['proofloop'],
  };

  it('renders scenarios and clients from API data', () => {
    render(
      <IncidentLauncher
        scenariosData={mockScenarios}
        isLoadingScenarios={false}
        onLaunch={vi.fn()}
        isLaunching={false}
        error={null}
      />
    );

    expect(screen.getByText('Launch Incident Simulation')).toBeInTheDocument();
    expect(screen.getByLabelText(/FAULT SCENARIO/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CLIENT POLICY CONTEXT/i)).toBeInTheDocument();

    expect(screen.getByRole('option', { name: 'clean_recovery' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'false_green' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /client_b/i })).toBeInTheDocument();
  });

  it('submits selected scenario, client, and mode when user clicks Start', () => {
    const onLaunchMock = vi.fn();
    render(
      <IncidentLauncher
        scenariosData={mockScenarios}
        isLoadingScenarios={false}
        onLaunch={onLaunchMock}
        isLaunching={false}
        error={null}
      />
    );

    const scenarioSelect = screen.getByLabelText(/FAULT SCENARIO/i);
    fireEvent.change(scenarioSelect, { target: { value: 'false_green' } });

    const clientSelect = screen.getByLabelText(/CLIENT POLICY CONTEXT/i);
    fireEvent.change(clientSelect, { target: { value: 'client_b' } });

    const submitBtn = screen.getByRole('button', { name: /Start Incident Run/i });
    fireEvent.click(submitBtn);

    expect(onLaunchMock).toHaveBeenCalledWith('false_green', 'client_b', 'proofloop');
  });

  it('displays API and network error messages clearly', () => {
    render(
      <IncidentLauncher
        scenariosData={mockScenarios}
        isLoadingScenarios={false}
        onLaunch={vi.fn()}
        isLaunching={false}
        error="Network connection to http://127.0.0.1:8000 failed"
      />
    );

    expect(screen.getByText(/Network connection to http:\/\/127.0.0.1:8000 failed/i)).toBeInTheDocument();
  });

  it('disables submit button while launching', () => {
    render(
      <IncidentLauncher
        scenariosData={mockScenarios}
        isLoadingScenarios={false}
        onLaunch={vi.fn()}
        isLaunching={true}
        error={null}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Starting Incident/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submits custom parameters when custom_incident is selected', () => {
    const onLaunchMock = vi.fn();
    const scenariosWithCustom = {
      scenarios: ['clean_recovery', 'custom_incident'],
      clients: ['client_a'],
      modes: ['proofloop'],
    };

    render(
      <IncidentLauncher
        scenariosData={scenariosWithCustom}
        isLoadingScenarios={false}
        onLaunch={onLaunchMock}
        isLaunching={false}
        error={null}
      />
    );

    const scenarioSelect = screen.getByLabelText(/FAULT SCENARIO/i);
    fireEvent.change(scenarioSelect, { target: { value: 'custom_incident' } });

    expect(screen.getByText(/Custom Incident Telemetry & Logs/i)).toBeInTheDocument();

    const logsInput = screen.getByLabelText(/Diagnostic Logs \/ Traces/i);
    fireEvent.change(logsInput, { target: { value: 'service: custom error trace\nconfig: broken' } });

    const submitBtn = screen.getByRole('button', { name: /Start Incident Run/i });
    fireEvent.click(submitBtn);

    expect(onLaunchMock).toHaveBeenCalledWith(
      'custom_incident',
      'client_a',
      'proofloop',
      expect.objectContaining({
        custom_logs: ['service: custom error trace', 'config: broken'],
        config_version: 'v_bad',
        health_endpoint_status: 503,
      })
    );
  });
});
