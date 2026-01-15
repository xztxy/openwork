/**
 * Integration tests for SettingsDialog component
 * Tests dialog rendering, wizard navigation, API key management, and debug mode
 * @module __tests__/integration/renderer/components/SettingsDialog.integration.test
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ApiKeyConfig } from '@accomplish/shared';

// Mock analytics to prevent tracking calls
vi.mock('@/lib/analytics', () => ({
  analytics: {
    trackToggleDebugMode: vi.fn(),
    trackSelectModel: vi.fn(),
    trackSaveApiKey: vi.fn(),
    trackSelectProvider: vi.fn(),
  },
}));

// Create mock functions for accomplish API
const mockGetApiKeys = vi.fn();
const mockGetDebugMode = vi.fn();
const mockGetVersion = vi.fn();
const mockGetSelectedModel = vi.fn();
const mockSetDebugMode = vi.fn();
const mockSetSelectedModel = vi.fn();
const mockAddApiKey = vi.fn();
const mockRemoveApiKey = vi.fn();
const mockValidateApiKeyForProvider = vi.fn();
const mockTestOllamaConnection = vi.fn();
const mockSetOllamaConfig = vi.fn();

// Mock accomplish API
const mockAccomplish = {
  getApiKeys: mockGetApiKeys,
  getDebugMode: mockGetDebugMode,
  getVersion: mockGetVersion,
  getSelectedModel: mockGetSelectedModel,
  setDebugMode: mockSetDebugMode,
  setSelectedModel: mockSetSelectedModel,
  addApiKey: mockAddApiKey,
  removeApiKey: mockRemoveApiKey,
  validateApiKeyForProvider: mockValidateApiKeyForProvider,
  testOllamaConnection: mockTestOllamaConnection,
  setOllamaConfig: mockSetOllamaConfig,
};

// Mock the accomplish module
vi.mock('@/lib/accomplish', () => ({
  getAccomplish: () => mockAccomplish,
}));

// Mock framer-motion to simplify testing animations
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => {
      // Filter out motion-specific props
      const { initial, animate, exit, transition, variants, whileHover, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Radix Dialog to simplify testing
vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    open ? <div data-testid="dialog-root">{children}</div> : null
  ),
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Overlay: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-overlay">{children}</div>
  ),
  Content: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid="dialog-content" role="dialog" {...props}>{children}</div>
  ),
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Close: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="dialog-close">{children}</button>
  ),
}));

// Need to import after mocks are set up
import SettingsDialog from '@/components/layout/SettingsDialog';

describe('SettingsDialog Integration', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onApiKeySaved: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockGetApiKeys.mockResolvedValue([]);
    mockGetDebugMode.mockResolvedValue(false);
    mockGetVersion.mockResolvedValue('1.0.0');
    mockGetSelectedModel.mockResolvedValue({ provider: 'anthropic', model: 'anthropic/claude-opus-4-5' });
    mockSetDebugMode.mockResolvedValue(undefined);
    mockSetSelectedModel.mockResolvedValue(undefined);
    mockValidateApiKeyForProvider.mockResolvedValue({ valid: true });
    mockAddApiKey.mockResolvedValue({ id: 'key-1', provider: 'anthropic', keyPrefix: 'sk-ant-...' });
    mockRemoveApiKey.mockResolvedValue(undefined);
    mockTestOllamaConnection.mockResolvedValue({ success: false, error: 'Connection failed' });
    mockSetOllamaConfig.mockResolvedValue(undefined);
  });

  describe('dialog rendering', () => {
    it('should render dialog when open is true', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should not render dialog when open is false', () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} open={false} />);

      // Assert
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render Settings title', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });
    });

    it('should fetch initial data on open', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(mockGetApiKeys).toHaveBeenCalled();
        expect(mockGetDebugMode).toHaveBeenCalled();
        expect(mockGetVersion).toHaveBeenCalled();
      });
    });

    it('should not fetch data when dialog is closed', () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} open={false} />);

      // Assert
      expect(mockGetApiKeys).not.toHaveBeenCalled();
      expect(mockGetDebugMode).not.toHaveBeenCalled();
    });

    it('should display current model when one is set', async () => {
      // Arrange
      mockGetSelectedModel.mockResolvedValue({ provider: 'anthropic', model: 'claude-opus-4-5' });
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Current Model')).toBeInTheDocument();
        expect(screen.getByText('claude-opus-4-5')).toBeInTheDocument();
      });
    });

    it('should not display current model section when no model is set', async () => {
      // Arrange
      mockGetSelectedModel.mockResolvedValue(null);
      render(<SettingsDialog {...defaultProps} />);

      // Assert - Wait for dialog to render
      await waitFor(() => {
        expect(screen.getByText('Choose Model')).toBeInTheDocument();
      });
      // Current Model section should not be present
      expect(screen.queryByText('Current Model')).not.toBeInTheDocument();
    });
  });

  describe('wizard navigation', () => {
    it('should show Choose Model step initially', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Choose Model')).toBeInTheDocument();
        expect(screen.getByText('Cloud')).toBeInTheDocument();
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
    });

    it('should navigate to Select Provider when Cloud is clicked', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act
      await waitFor(() => {
        expect(screen.getByText('Cloud')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Cloud'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Select Provider')).toBeInTheDocument();
      });
    });

    it('should show provider buttons on Select Provider step', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act - Navigate to Select Provider
      await waitFor(() => {
        expect(screen.getByText('Cloud')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Cloud'));

      // Assert - All providers should be visible
      await waitFor(() => {
        expect(screen.getByText('Anthropic')).toBeInTheDocument();
        expect(screen.getByText('OpenAI')).toBeInTheDocument();
        expect(screen.getByText('Google AI')).toBeInTheDocument();
        expect(screen.getByText('xAI (Grok)')).toBeInTheDocument();
      });
    });

    it('should navigate to Ollama Setup when Local is clicked', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Local Models')).toBeInTheDocument();
      });
    });

    it('should show Ollama URL input on Local Models step', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      // Assert
      await waitFor(() => {
        expect(screen.getByPlaceholderText('http://localhost:11434')).toBeInTheDocument();
        expect(screen.getByText('Test')).toBeInTheDocument();
      });
    });

    it('should navigate back from Select Provider to Choose Model', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act - Navigate to Select Provider
      await waitFor(() => {
        expect(screen.getByText('Cloud')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Cloud'));

      // Verify we're on Select Provider
      await waitFor(() => {
        expect(screen.getByText('Select Provider')).toBeInTheDocument();
      });

      // Act - Click Back button
      fireEvent.click(screen.getByText('Back'));

      // Assert - Back at Choose Model
      await waitFor(() => {
        expect(screen.getByText('Choose Model')).toBeInTheDocument();
        expect(screen.getByText('Cloud')).toBeInTheDocument();
      });
    });

    it('should navigate back from Local Models to Choose Model', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act - Navigate to Local Models
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      // Verify we're on Local Models
      await waitFor(() => {
        expect(screen.getByText('Local Models')).toBeInTheDocument();
      });

      // Act - Click Back button
      fireEvent.click(screen.getByText('Back'));

      // Assert - Back at Choose Model
      await waitFor(() => {
        expect(screen.getByText('Choose Model')).toBeInTheDocument();
      });
    });
  });

  describe('API keys section', () => {
    it('should render API Keys section', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('My API Keys')).toBeInTheDocument();
      });
    });

    it('should render Add API Key button', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
    });

    it('should show add form when Add API Key is clicked', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Add API Key'));

      // Assert - Form should appear with provider buttons
      await waitFor(() => {
        expect(screen.getByText('Add New API Key')).toBeInTheDocument();
        expect(screen.getByText('Anthropic')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
        expect(screen.getByText('Save API Key')).toBeInTheDocument();
      });
    });

    it('should render saved API keys', async () => {
      // Arrange
      const savedKeys: ApiKeyConfig[] = [
        { id: 'key-1', provider: 'anthropic', keyPrefix: 'sk-ant-abc...' },
        { id: 'key-2', provider: 'openai', keyPrefix: 'sk-xyz...' },
      ];
      mockGetApiKeys.mockResolvedValue(savedKeys);
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('sk-ant-abc...')).toBeInTheDocument();
        expect(screen.getByText('sk-xyz...')).toBeInTheDocument();
      });
    });

    it('should show delete button for each saved key', async () => {
      // Arrange
      const savedKeys: ApiKeyConfig[] = [
        { id: 'key-1', provider: 'anthropic', keyPrefix: 'sk-ant-abc...' },
      ];
      mockGetApiKeys.mockResolvedValue(savedKeys);
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByTitle('Remove API key')).toBeInTheDocument();
      });
    });

    it('should delete API key when delete button is clicked and confirmed', async () => {
      // Arrange
      const savedKeys: ApiKeyConfig[] = [
        { id: 'key-1', provider: 'anthropic', keyPrefix: 'sk-ant-abc...' },
      ];
      mockGetApiKeys.mockResolvedValue(savedKeys);
      render(<SettingsDialog {...defaultProps} />);

      // Act - Click delete button to show confirmation
      await waitFor(() => {
        expect(screen.getByTitle('Remove API key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTitle('Remove API key'));

      // Act - Confirm deletion by clicking Yes
      await waitFor(() => {
        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /yes/i }));

      // Assert
      await waitFor(() => {
        expect(mockRemoveApiKey).toHaveBeenCalledWith('key-1');
      });
    });

    it('should not delete API key when confirmation is cancelled', async () => {
      // Arrange
      const savedKeys: ApiKeyConfig[] = [
        { id: 'key-1', provider: 'anthropic', keyPrefix: 'sk-ant-abc...' },
      ];
      mockGetApiKeys.mockResolvedValue(savedKeys);
      render(<SettingsDialog {...defaultProps} />);

      // Act - Click delete button to show confirmation
      await waitFor(() => {
        expect(screen.getByTitle('Remove API key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTitle('Remove API key'));

      // Act - Cancel by clicking No
      await waitFor(() => {
        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /no/i }));

      // Assert - Should not delete, confirmation should be hidden
      expect(mockRemoveApiKey).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument();
      });
    });
  });

  describe('API key input and saving', () => {
    it('should show error when saving empty API key', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act - Open add form
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Add API Key'));

      // Act - Try to save without entering a key
      await waitFor(() => {
        expect(screen.getByText('Save API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Save API Key'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Please enter an API key.')).toBeInTheDocument();
      });
    });

    it('should show error when API key format is invalid', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act - Open add form
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Add API Key'));

      // Act - Enter invalid key and save
      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
      });
      fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), { target: { value: 'invalid-key' } });
      fireEvent.click(screen.getByText('Save API Key'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Invalid API key format/i)).toBeInTheDocument();
      });
    });

    it('should validate and save valid API key', async () => {
      // Arrange
      mockValidateApiKeyForProvider.mockResolvedValue({ valid: true });
      mockAddApiKey.mockResolvedValue({ id: 'key-1', provider: 'anthropic', keyPrefix: 'sk-ant-...' });
      render(<SettingsDialog {...defaultProps} />);

      // Act - Open add form
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Add API Key'));

      // Act - Enter valid key and save
      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
      });
      fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-test123' } });
      fireEvent.click(screen.getByText('Save API Key'));

      // Assert
      await waitFor(() => {
        expect(mockValidateApiKeyForProvider).toHaveBeenCalledWith('anthropic', 'sk-ant-test123');
        expect(mockAddApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test123');
      });
    });

    it('should show error when API key validation fails', async () => {
      // Arrange
      mockValidateApiKeyForProvider.mockResolvedValue({ valid: false, error: 'Invalid API key' });
      render(<SettingsDialog {...defaultProps} />);

      // Act - Open add form
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Add API Key'));

      // Act - Enter key and save
      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
      });
      fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-invalid' } });
      fireEvent.click(screen.getByText('Save API Key'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Invalid API key')).toBeInTheDocument();
      });
    });

    it('should show Saving... while saving is in progress', async () => {
      // Arrange
      mockValidateApiKeyForProvider.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ valid: true }), 100))
      );
      render(<SettingsDialog {...defaultProps} />);

      // Act - Open add form
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Add API Key'));

      // Act - Enter key and save
      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
      });
      fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-valid123' } });
      fireEvent.click(screen.getByText('Save API Key'));

      // Assert
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('should change provider in add form when button is clicked', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act - Open add form
      await waitFor(() => {
        expect(screen.getByText('Add API Key')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Add API Key'));

      // Act - Click Google AI provider
      await waitFor(() => {
        expect(screen.getByText('Google AI')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Google AI'));

      // Assert - Placeholder should change to Google AI format
      await waitFor(() => {
        expect(screen.getByPlaceholderText('AIza...')).toBeInTheDocument();
      });
    });
  });

  describe('ollama setup', () => {
    it('should show Test button on Ollama setup', async () => {
      // Arrange
      render(<SettingsDialog {...defaultProps} />);

      // Act - Navigate to Local
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument();
      });
    });

    it('should show Testing... when connection is being tested', async () => {
      // Arrange
      mockTestOllamaConnection.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: false }), 100))
      );
      render(<SettingsDialog {...defaultProps} />);

      // Act - Navigate to Local and click Test
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Test'));

      // Assert
      expect(screen.getByText('Testing...')).toBeInTheDocument();
    });

    it('should show error message when Ollama connection fails', async () => {
      // Arrange
      mockTestOllamaConnection.mockResolvedValue({ success: false, error: 'Connection refused' });
      render(<SettingsDialog {...defaultProps} />);

      // Act - Navigate to Local and test connection
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Test'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Connection refused')).toBeInTheDocument();
      });
    });

    it('should show model selection when Ollama connects successfully', async () => {
      // Arrange
      mockTestOllamaConnection.mockResolvedValue({
        success: true,
        models: [
          { id: 'llama2', displayName: 'Llama 2', size: 4000000000 },
          { id: 'codellama', displayName: 'Code Llama', size: 7000000000 },
        ],
      });
      render(<SettingsDialog {...defaultProps} />);

      // Act - Navigate to Local and test connection
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Test'));

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Connected/)).toBeInTheDocument();
        expect(screen.getByText('Use This Model')).toBeInTheDocument();
      });
    });

    it('should show success message and stay on settings page after model selection', async () => {
      // Arrange
      mockTestOllamaConnection.mockResolvedValue({
        success: true,
        models: [
          { id: 'llama2', displayName: 'Llama 2', size: 4000000000 },
        ],
      });
      mockSetOllamaConfig.mockResolvedValue(undefined);
      mockSetSelectedModel.mockResolvedValue(undefined);
      mockGetSelectedModel.mockResolvedValue({ provider: 'ollama', model: 'llama2' });

      const onOpenChangeMock = vi.fn();
      render(<SettingsDialog {...defaultProps} onOpenChange={onOpenChangeMock} />);

      // Act - Navigate to Local, test connection, and select model
      await waitFor(() => {
        expect(screen.getByText('Local')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Local'));

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Test'));

      await waitFor(() => {
        expect(screen.getByText('Use This Model')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Use This Model'));

      // Assert - Success message should appear
      await waitFor(() => {
        expect(screen.getByText(/Model set to/)).toBeInTheDocument();
      });

      // Assert - Dialog should NOT be closed (onOpenChange should not be called with false)
      // This verifies the new behavior of staying on settings page instead of closing
      expect(onOpenChangeMock).not.toHaveBeenCalledWith(false);
    });
  });

  describe('debug mode toggle', () => {
    it('should render Developer section', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Developer')).toBeInTheDocument();
      });
    });

    it('should render Debug Mode toggle', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Debug Mode')).toBeInTheDocument();
      });
    });

    it('should show debug mode as disabled initially', async () => {
      // Arrange
      mockGetDebugMode.mockResolvedValue(false);
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        const toggle = screen.getByTestId('settings-debug-toggle');
        expect(toggle.className).toContain('bg-muted');
      });
    });

    it('should toggle debug mode when clicked', async () => {
      // Arrange
      mockGetDebugMode.mockResolvedValue(false);
      render(<SettingsDialog {...defaultProps} />);

      // Act - Find and click the toggle
      await waitFor(() => {
        expect(screen.getByTestId('settings-debug-toggle')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('settings-debug-toggle'));

      // Assert
      await waitFor(() => {
        expect(mockSetDebugMode).toHaveBeenCalledWith(true);
      });
    });

    it('should show debug mode warning when enabled', async () => {
      // Arrange
      mockGetDebugMode.mockResolvedValue(true);
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/Debug mode is enabled/i)).toBeInTheDocument();
      });
    });

    it('should show loading skeleton while fetching debug setting', async () => {
      // Arrange
      mockGetDebugMode.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(false), 500))
      );
      render(<SettingsDialog {...defaultProps} />);

      // Assert - Check for skeleton animation
      await waitFor(() => {
        const skeletons = document.querySelectorAll('.animate-pulse');
        expect(skeletons.length).toBeGreaterThan(0);
      });
    });

    it('should revert toggle state on save error', async () => {
      // Arrange
      mockGetDebugMode.mockResolvedValue(false);
      mockSetDebugMode.mockRejectedValue(new Error('Save failed'));
      render(<SettingsDialog {...defaultProps} />);

      // Act
      await waitFor(() => {
        expect(screen.getByTestId('settings-debug-toggle')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('settings-debug-toggle'));

      // Assert - Mock should have been called and error handled
      await waitFor(() => {
        expect(mockSetDebugMode).toHaveBeenCalled();
      });
    });
  });

  describe('about section', () => {
    it('should render About section', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('About')).toBeInTheDocument();
      });
    });

    it('should render app name', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Openwork')).toBeInTheDocument();
      });
    });

    it('should render app version', async () => {
      // Arrange
      mockGetVersion.mockResolvedValue('2.0.0');
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Version 2.0.0')).toBeInTheDocument();
      });
    });

    it('should render app logo', async () => {
      // Arrange & Act
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        const logo = screen.getByRole('img', { name: /openwork/i });
        expect(logo).toBeInTheDocument();
      });
    });

    it('should show default version when fetch fails', async () => {
      // Arrange
      mockGetVersion.mockRejectedValue(new Error('Fetch failed'));
      render(<SettingsDialog {...defaultProps} />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Version 0.1.0')).toBeInTheDocument();
      });
    });
  });
});
