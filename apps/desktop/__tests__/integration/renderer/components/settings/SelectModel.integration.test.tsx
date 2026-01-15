/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSetSelectedModel = vi.fn();

vi.mock('@/lib/accomplish', () => ({
  getAccomplish: () => ({
    setSelectedModel: mockSetSelectedModel,
  }),
}));

vi.mock('@/lib/analytics', () => ({
  analytics: { trackSelectModel: vi.fn() },
}));

import SelectModel from '@/components/layout/settings/SelectModel';

describe('SelectModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetSelectedModel.mockResolvedValue(undefined);
  });

  describe('rendering', () => {
    it('should render model dropdown for selected provider', () => {
      render(<SelectModel providerId="anthropic" onDone={vi.fn()} onBack={vi.fn()} />);

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should render Select Model title', () => {
      render(<SelectModel providerId="anthropic" onDone={vi.fn()} onBack={vi.fn()} />);

      expect(screen.getByText('Select Model')).toBeInTheDocument();
    });
  });

  describe('selection behavior', () => {
    it('should call onDone with model name after selection', async () => {
      const onDone = vi.fn();
      render(<SelectModel providerId="anthropic" onDone={onDone} onBack={vi.fn()} />);

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'anthropic/claude-sonnet-4-5' } });
      fireEvent.click(screen.getByRole('button', { name: /done/i }));

      await waitFor(() => {
        expect(onDone).toHaveBeenCalled();
      });
    });
  });

  describe('navigation', () => {
    it('should call onBack when Back button is clicked', () => {
      const onBack = vi.fn();
      render(<SelectModel providerId="anthropic" onDone={vi.fn()} onBack={onBack} />);

      fireEvent.click(screen.getByRole('button', { name: /back/i }));

      expect(onBack).toHaveBeenCalled();
    });
  });
});
