import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateSkillModal } from '@/components/skills/CreateSkillModal';

const mockStartTask = vi.fn();
const mockNavigate = vi.fn();
const mockGetProviderSettings = vi.fn();
const mockGetUserSkillsPath = vi.fn();
const mockGetPlatform = vi.fn();

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: () => ({
    startTask: mockStartTask,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/accomplish', () => ({
  getAccomplish: () => ({
    getProviderSettings: mockGetProviderSettings,
    getUserSkillsPath: mockGetUserSkillsPath,
    getPlatform: mockGetPlatform,
  }),
}));

describe('CreateSkillModal', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetProviderSettings.mockResolvedValue({ activeProviderId: 'provider-1' });
    mockGetUserSkillsPath.mockResolvedValue(
      '/Users/test/Library/Application Support/Accomplish/skills',
    );
    mockGetPlatform.mockResolvedValue('darwin');
    mockStartTask.mockResolvedValue({ id: 'task-123' });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('shows a visible error for bootstrap failure and clears it on retry', async () => {
    const onOpenChange = vi.fn();

    render(<CreateSkillModal open={true} onOpenChange={onOpenChange} />);

    await waitFor(() => {
      expect(mockGetProviderSettings).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText('Skill Name'), { target: { value: 'My Skill' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Do useful work' } });

    mockGetUserSkillsPath.mockRejectedValueOnce(new Error('IPC failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Skill' }));

    expect(
      await screen.findByText('Failed to start skill creation. Please try again.'),
    ).toBeInTheDocument();
    expect(mockStartTask).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Skill' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Skill' }));

    await waitFor(() => {
      expect(mockStartTask).toHaveBeenCalledTimes(1);
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/execution/task-123');
    expect(
      screen.queryByText('Failed to start skill creation. Please try again.'),
    ).not.toBeInTheDocument();
  });
});
