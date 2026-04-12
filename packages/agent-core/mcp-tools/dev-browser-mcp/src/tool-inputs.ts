export interface BrowserNavigateInput {
  url: string;
  page_name?: string;
}

export interface BrowserSnapshotInput {
  page_name?: string;
  interactive_only?: boolean; // default true — only buttons, inputs, links
  full_snapshot?: boolean; // default false
  max_elements?: number; // default 300, range 1-1000
  viewport_only?: boolean;
  include_history?: boolean; // default true
  max_tokens?: number; // default 8000, range 1000-50000
}

export interface BrowserClickInput {
  ref?: string; // element reference from snapshot (e.g. "e5")
  selector?: string; // CSS / XPath selector
  x?: number; // absolute coordinates
  y?: number;
  position?: 'center' | 'center-lower';
  button?: 'left' | 'right' | 'middle';
  click_count?: number;
  trigger_ref?: string; // ref of element that triggers a popup/dropdown
  page_name?: string;
}

export interface BrowserTypeInput {
  ref?: string;
  selector?: string;
  text: string;
  press_enter?: boolean;
  page_name?: string;
}

export interface BrowserScreenshotInput {
  page_name?: string;
  full_page?: boolean;
}

export interface BrowserEvaluateInput {
  script: string;
  page_name?: string;
}

export interface BrowserKeyboardInput {
  text?: string; // characters to type via keyboard events
  key?: string; // single key name e.g. "Enter", "ArrowDown"
  typing_delay?: number; // ms between keystrokes
  page_name?: string;
}

export interface SequenceAction {
  action: 'click' | 'type' | 'snapshot' | 'screenshot' | 'wait';
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  press_enter?: boolean;
  full_page?: boolean;
  timeout?: number;
}

export interface BrowserSequenceInput {
  actions: SequenceAction[];
  page_name?: string;
}

export interface ScriptAction {
  action:
    | 'goto'
    | 'waitForLoad'
    | 'waitForSelector'
    | 'waitForNavigation'
    | 'findAndFill'
    | 'findAndClick'
    | 'fillByRef'
    | 'clickByRef'
    | 'snapshot'
    | 'screenshot'
    | 'keyboard'
    | 'evaluate';
  url?: string;
  selector?: string;
  ref?: string;
  text?: string;
  key?: string;
  pressEnter?: boolean;
  timeout?: number;
  fullPage?: boolean;
  code?: string;
  skipIfNotFound?: boolean;
}

export interface BrowserScriptInput {
  actions: ScriptAction[];
  page_name?: string;
}

export interface BrowserScrollInput {
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  ref?: string;
  selector?: string;
  position?: 'top' | 'bottom';
  page_name?: string;
}

export interface BrowserHoverInput {
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
  page_name?: string;
}

export interface BrowserSelectInput {
  ref?: string;
  selector?: string;
  value?: string;
  label?: string;
  index?: number;
  page_name?: string;
}

export interface BrowserWaitInput {
  condition: 'selector' | 'hidden' | 'navigation' | 'network_idle' | 'timeout' | 'function';
  selector?: string;
  script?: string;
  timeout?: number;
  page_name?: string;
}

export interface BrowserFileUploadInput {
  ref?: string;
  selector?: string;
  files: string[];
  page_name?: string;
}

export interface BrowserDragInput {
  source_ref?: string;
  source_selector?: string;
  source_x?: number;
  source_y?: number;
  target_ref?: string;
  target_selector?: string;
  target_x?: number;
  target_y?: number;
  page_name?: string;
}

export interface BrowserGetTextInput {
  ref?: string;
  selector?: string;
  page_name?: string;
}

export interface BrowserIsVisibleInput {
  ref?: string;
  selector?: string;
  page_name?: string;
}
export interface BrowserIsEnabledInput {
  ref?: string;
  selector?: string;
  page_name?: string;
}
export interface BrowserIsCheckedInput {
  ref?: string;
  selector?: string;
  page_name?: string;
}

export interface BrowserIframeInput {
  action: 'enter' | 'exit';
  ref?: string;
  selector?: string;
  page_name?: string;
}

export interface BrowserCanvasTypeInput {
  text: string;
  position?: 'start' | 'current';
  page_name?: string;
}

export interface BrowserHighlightInput {
  enabled: boolean;
  page_name?: string;
}
