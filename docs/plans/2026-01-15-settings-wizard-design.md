# Settings Page Wizard Redesign

## Overview

Transform the settings dialog from a tabbed interface into a step-by-step wizard flow for model configuration, while keeping other settings (API Keys, Language, Debug, About) always accessible below.

## Wizard Flow

### Step 1: Choose Model Type

First screen shows two options as clickable cards:

- **Cloud** - Use AI models from cloud providers (Anthropic, OpenAI, Google AI, xAI)
- **Local** - Use Ollama models running on user's machine

### Cloud Path

**Step 2: Select Provider**

Four provider cards in a 2x2 grid:
- Anthropic
- OpenAI
- Google AI
- xAI (Grok)

Navigation: Back button, Next button (enabled after selection)

**Step 3: Add API Key** (conditional)

- Skip this step if user already has an API key for the selected provider
- Show provider name and key input field
- Validate key before proceeding
- Navigation: Back button, "Validate & Next" button

**Step 4: Choose Model**

- Dropdown showing only models for the selected provider
- Navigation: Back button, Done button

**Completion:** Show brief confirmation message ("Model set to X"), then close dialog.

### Local Path

**Step 2: Ollama Setup**

Keep existing Ollama flow:
- Server URL input with Test button
- Connection status indicator
- Model dropdown (shown after successful connection)
- "Use This Model" button

**Completion:** Show confirmation, close dialog.

## Always-Visible Sections

Below the wizard area, these sections remain visible at all times:

### API Keys Section

- List of saved API keys showing:
  - Provider name
  - Masked key prefix (e.g., `sk-ant-***`)
  - Delete button with confirmation
- "Add API Key" button that expands inline to show:
  - Provider selection (4 buttons)
  - Key input field
  - Save button

### Language Section

- Dropdown to select app language (English, Japanese)

### Developer Section

- Debug mode toggle with description

### About Section

- App logo, name, version
- Description text
- Contact link

## Visual Structure

```
┌─────────────────────────────────────────┐
│  Settings                          [X]  │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │      Wizard Steps Area          │    │
│  │      (changes per step)         │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  API Keys                               │
│  [saved keys list + add button]         │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Language [dropdown]                    │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Developer                              │
│  Debug Mode [toggle]                    │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  About                                  │
│  Openwork v0.1.0                        │
│                                         │
└─────────────────────────────────────────┘
```

## Navigation Behavior

- Back/Next buttons for moving between wizard steps
- Users can navigate backwards to change earlier choices
- Selecting Cloud/Local in Step 1 resets subsequent steps
- Dialog closes automatically after successful model selection

## State Management

Track wizard state:
- `wizardStep`: 'choose-type' | 'select-provider' | 'add-api-key' | 'select-model' | 'ollama-setup'
- `selectedType`: 'cloud' | 'local' | null
- `selectedProvider`: provider id or null
- `selectedModel`: model id or null

## Implementation Notes

- Reuse existing components where possible (provider buttons, API key input, Ollama setup)
- Keep all existing IPC handlers and data fetching logic
- Add step indicator or breadcrumb for user orientation (optional)
- Maintain existing i18n translation keys, add new ones as needed
