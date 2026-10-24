import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Header } from '../components/Header';
import { SidebarNav } from '../components/SidebarNav';

describe('Navigation Architecture', () => {
  it('renders all 5 view destinations in the Header navbar', () => {
    const onSelectViewMock = vi.fn();
    render(
      <Header
        activeView="operations"
        onSelectView={onSelectViewMock}
        health={null}
        connectionStatus="disconnected"
        onRefreshHistory={vi.fn()}
        onOpenHistory={vi.fn()}
        pendingApprovalsCount={0}
      />
    );

    const opsBtn = screen.getByRole('button', { name: /Live Operations View/i });
    const invBtn = screen.getByRole('button', { name: /Investigations View/i });
    const incBtn = screen.getByRole('button', { name: /Incidents View/i });
    const appBtn = screen.getByRole('button', { name: /Approvals View/i });
    const benchBtn = screen.getByRole('button', { name: /Benchmark View/i });

    expect(opsBtn).toBeInTheDocument();
    expect(invBtn).toBeInTheDocument();
    expect(incBtn).toBeInTheDocument();
    expect(appBtn).toBeInTheDocument();
    expect(benchBtn).toBeInTheDocument();

    fireEvent.click(invBtn);
    expect(onSelectViewMock).toHaveBeenCalledWith('investigations');

    fireEvent.click(incBtn);
    expect(onSelectViewMock).toHaveBeenCalledWith('incidents');

    fireEvent.click(appBtn);
    expect(onSelectViewMock).toHaveBeenCalledWith('approvals');

    fireEvent.click(benchBtn);
    expect(onSelectViewMock).toHaveBeenCalledWith('benchmark');

    fireEvent.click(opsBtn);
    expect(onSelectViewMock).toHaveBeenCalledWith('operations');
  });

  it('renders pending approvals indicator badge when count > 0', () => {
    render(
      <Header
        activeView="operations"
        onSelectView={vi.fn()}
        health={null}
        connectionStatus="disconnected"
        onRefreshHistory={vi.fn()}
        onOpenHistory={vi.fn()}
        pendingApprovalsCount={2}
      />
    );

    const appBtn = screen.getByRole('button', { name: /Approvals View/i });
    expect(appBtn.querySelector('.bg-amber-500')).toBeInTheDocument();
  });

  it('renders all 5 destinations in SidebarNav component', () => {
    const onViewSelectMock = vi.fn();
    render(
      <SidebarNav
        activeView="operations"
        onViewSelect={onViewSelectMock}
      />
    );

    expect(screen.getByRole('button', { name: /LIVE OPERATIONS/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /INVESTIGATIONS/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /INCIDENTS/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /APPROVALS/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /BENCHMARK/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /INVESTIGATIONS/i }));
    expect(onViewSelectMock).toHaveBeenCalledWith('investigations');
  });
});
