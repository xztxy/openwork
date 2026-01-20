# Settings Page Animations Design

## Overview

Add animations to all Settings page interactions for a polished, professional user experience.

**Philosophy:** Subtle & Professional
- Fast transitions (150-200ms) that users feel but don't slow them down
- No layout jumping - cards maintain fixed positions
- Consistent animation language across all interactions

**Implementation:** Hybrid Approach
- **Framer Motion** for complex cases: panel enter/exit, grid expand/collapse, form crossfades, status messages, dropdowns
- **CSS Transitions** for simple cases: hover states, selection states, toggle switch (already done)

## Animation Specifications

### Timing & Easing

| Interaction Type | Duration | Easing |
|-----------------|----------|--------|
| Hover states | 150ms | CSS `ease-accomplish` |
| Selection states | 150ms | CSS `ease-accomplish` |
| Content enter | 200ms | Framer `springs.snappy` |
| Content exit | 150ms | Framer `springs.snappy` |
| Crossfades | 200ms | Framer `springs.snappy` |

---

## 1. Provider Grid Animations

### Card Selection (CSS - already partial)
- Hover: `background-color` transition 150ms
- Select: `border-color` and `background-color` transition 150ms
- Keep existing `transition-[background-color,border-color] duration-150`

### Search Input
- Clear button: Fade in/out 150ms when text present/cleared
- Filtering: Instant (no animation - search should feel immediate)

### Show All / Hide Toggle (Framer Motion)

**Expand:**
```typescript
// First 4 cards: No animation (stay in place)
// Cards 5-10: Staggered fade + slide
{
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, delay: index * 0.04 } // 40ms stagger
}
```

**Collapse:**
```typescript
// Cards 5-10: Fade out simultaneously
{
  exit: { opacity: 0 },
  transition: { duration: 0.15 }
}
// First 4 cards: No animation
```

### Connected Badge (Framer Motion)
```typescript
// When provider becomes connected
{
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 }
}
```

---

## 2. ProviderSettingsPanel Animations

### Panel Enter (Framer Motion)
```typescript
// When provider selected
{
  initial: { opacity: 0, y: -12 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", ...springs.snappy }
}
```

### Panel Exit (Framer Motion)
```typescript
// When provider deselected
{
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.15 }
}
```

### Form Crossfade (Framer Motion)
```typescript
// When switching providers (e.g., Anthropic → OpenAI)
<AnimatePresence mode="wait">
  <motion.div
    key={selectedProvider}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.15 }}
  >
    {/* Provider form content */}
  </motion.div>
</AnimatePresence>
```

### Connect → Connected State Transition
```typescript
// Within form, when connection state changes
<AnimatePresence mode="wait">
  <motion.div
    key={isConnected ? 'connected' : 'disconnected'}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.15 }}
  >
    {isConnected ? <ConnectedControls /> : <ConnectionForm />}
  </motion.div>
</AnimatePresence>
```

---

## 3. Status Messages & Alerts

### Error Messages (FormError)
```typescript
<AnimatePresence>
  {error && (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      {error}
    </motion.div>
  )}
</AnimatePresence>
```

### Close Warning Alert
```typescript
<AnimatePresence>
  {closeWarning && (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Warning content */}
    </motion.div>
  )}
</AnimatePresence>
```

### Connection Status Changes
- State transitions use crossfade pattern
- Connected state: Optional subtle pulse (1 → 1.02 → 1) over 300ms

---

## 4. Model Selector Dropdown

### Dropdown Open (Framer Motion)
```typescript
{
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  style: { transformOrigin: "top" },
  transition: { duration: 0.15 }
}
```

### Dropdown Close (Framer Motion)
```typescript
{
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.1 } // Faster exit
}
```

### Chevron Rotation (CSS)
- Keep existing `transition-transform`
- Rotates 180° when open

### Model List
- Filtering: Instant (no animation)
- Hover: Background color transition 150ms (CSS)

---

## 5. Debug Mode Section

- Appears/disappears with panel (inherits panel animation)
- Toggle switch: Keep existing CSS transitions (already implemented)
  - Container: `transition-colors duration-200 ease-accomplish`
  - Knob: `transition-transform duration-200 ease-accomplish`

---

## Implementation Plan

### Files to Modify

| File | Changes |
|------|---------|
| `SettingsDialog.tsx` | AnimatePresence for close warning, wrap ProviderSettingsPanel |
| `ProviderGrid.tsx` | AnimatePresence for expand/collapse, staggered card animations |
| `ProviderCard.tsx` | AnimatePresence for connected badge |
| `ProviderSettingsPanel.tsx` | motion wrapper, AnimatePresence for form crossfade |
| `ClassicProviderForm.tsx` | AnimatePresence for connect/connected state swap |
| `BedrockProviderForm.tsx` | Same pattern as ClassicProvider |
| `OllamaProviderForm.tsx` | Same pattern |
| `OpenRouterProviderForm.tsx` | Same pattern |
| `LiteLLMProviderForm.tsx` | Same pattern |
| `ModelSelector.tsx` | AnimatePresence for dropdown open/close |
| `FormError.tsx` | motion wrapper with fade+slide |
| `ConnectionStatus.tsx` | AnimatePresence for status transitions |

### Implementation Order

1. **Shared utilities first** - Add animation variants to `animations.ts` if needed
2. **FormError.tsx** - Small, isolated, good test case
3. **ModelSelector.tsx** - Dropdown animations
4. **ProviderCard.tsx** - Connected badge animation
5. **ProviderGrid.tsx** - Expand/collapse with stagger
6. **ProviderSettingsPanel.tsx** - Panel enter/exit + form crossfade
7. **Provider forms** (5 files) - Connect/connected state transitions
8. **SettingsDialog.tsx** - Close warning animation
9. **ConnectionStatus.tsx** - Status transitions

### Estimated Scope

- 12 files modified
- ~200-300 lines of animation code total
- No structural changes to component logic
- All animations use existing Framer Motion and CSS infrastructure

---

## Key Constraints

1. **No layout jumping** - First 4 provider cards always stay in fixed positions
2. **Fast transitions** - Nothing exceeds 200ms for enter, 150ms for exit
3. **Instant filtering** - Search results appear immediately (no animation delay)
4. **Preserve existing animations** - Debug toggle CSS transitions remain unchanged
5. **Consistent patterns** - Same animation style for similar interactions across components
