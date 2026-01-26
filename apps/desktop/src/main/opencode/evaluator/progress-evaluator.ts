import * as pty from 'node-pty';
import { app } from 'electron';
import fs from 'fs';
import { getOpenCodeCliPath } from '../cli-path';
import { getBundledNodePaths } from '../../utils/bundled-node';
import { getExtendedNodePath } from '../../utils/system-path';
import { getAllApiKeys, getBedrockCredentials } from '../../store/secureStorage';
import { getActiveProviderModel } from '../../store/providerSettings';
import { getSelectedModel } from '../../store/appSettings';
import {
  buildEvaluationPrompt,
  type EvaluationResult,
} from './prompts';
import type { EvaluationContext } from './index';

const DEFAULT_MAX_CYCLES = 5;
const EVALUATOR_TIMEOUT_MS = 60000;

/**
 * Spawns a separate OpenCode CLI instance as an evaluator agent to assess
 * whether a task has been completed. Collects CLI output, parses JSON
 * evaluation results, and detects stuckness across evaluation cycles.
 */
export class ProgressEvaluator {
  private maxCycles: number;
  private evaluationHistory: EvaluationResult[] = [];
  private currentProcess: pty.IPty | null = null;
  private isDisposed = false;

  constructor(maxCycles = DEFAULT_MAX_CYCLES) {
    this.maxCycles = maxCycles;
  }

  /**
   * Run an evaluation cycle. Builds the evaluation prompt from context,
   * spawns an evaluator CLI process, parses the JSON response, and
   * checks for stuckness.
   */
  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    if (this.isDisposed) {
      throw new Error('Evaluator has been disposed');
    }

    const prompt = buildEvaluationPrompt(
      context.originalRequest,
      context.conversationLog,
      context.todoState,
      this.evaluationHistory
    );

    const rawOutput = await this.spawnEvaluatorProcess(prompt);
    const result = this.parseEvaluatorResponse(rawOutput);

    // Layer on stuckness detection if the evaluator didn't flag it
    if (!result.is_stuck) {
      result.is_stuck = this.detectStuckness(result);
    }

    this.evaluationHistory.push(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  /** Number of evaluation cycles completed so far. */
  get cycleCount(): number {
    return this.evaluationHistory.length;
  }

  /** Whether the maximum number of evaluation cycles has been reached. */
  get isMaxCyclesReached(): boolean {
    return this.evaluationHistory.length >= this.maxCycles;
  }

  /** The most recent evaluation result, or null if none. */
  get lastResult(): EvaluationResult | null {
    return this.evaluationHistory.length > 0
      ? this.evaluationHistory[this.evaluationHistory.length - 1]
      : null;
  }

  /** Read-only view of the full evaluation history. */
  get history(): readonly EvaluationResult[] {
    return this.evaluationHistory;
  }

  // ---------------------------------------------------------------------------
  // Process spawning
  // ---------------------------------------------------------------------------

  /**
   * Spawn an OpenCode CLI process configured as the evaluator agent.
   * Collects all output and returns it as a string once the process exits.
   * Times out after EVALUATOR_TIMEOUT_MS.
   */
  private async spawnEvaluatorProcess(prompt: string): Promise<string> {
    const { command, args: baseArgs } = getOpenCodeCliPath();

    // Build CLI args: run "<prompt>" --format json --agent evaluator
    const cliArgs = ['run', prompt, '--format', 'json', '--agent', 'evaluator'];

    // Add model selection — mirrors adapter.buildCliArgs logic
    const activeModel = getActiveProviderModel();
    const selectedModel = activeModel || getSelectedModel();
    if (selectedModel?.model) {
      if (selectedModel.provider === 'zai') {
        const modelId = selectedModel.model.split('/').pop();
        cliArgs.push('--model', `zai-coding-plan/${modelId}`);
      } else if (selectedModel.provider === 'deepseek') {
        const modelId = selectedModel.model.split('/').pop();
        cliArgs.push('--model', `deepseek/${modelId}`);
      } else if (selectedModel.provider === 'openrouter') {
        cliArgs.push('--model', selectedModel.model);
      } else if (selectedModel.provider === 'ollama') {
        const modelId = selectedModel.model.replace(/^ollama\//, '');
        cliArgs.push('--model', `ollama/${modelId}`);
      } else if (selectedModel.provider === 'litellm') {
        const modelId = selectedModel.model.replace(/^litellm\//, '');
        cliArgs.push('--model', `litellm/${modelId}`);
      } else {
        cliArgs.push('--model', selectedModel.model);
      }
    }

    const allArgs = [...baseArgs, ...cliArgs];
    const env = await this.buildEvaluatorEnvironment();
    const safeCwd = app.getPath('temp');

    return new Promise<string>((resolve, reject) => {
      let output = '';
      let timeoutId: ReturnType<typeof setTimeout>;

      const fullCommand = this.buildShellCommand(command, allArgs);
      const shellCmd = this.getPlatformShell();
      const shellArgs = this.getShellArgs(fullCommand);

      console.log('[ProgressEvaluator] Spawning evaluator process');
      console.log('[ProgressEvaluator] Shell command:', fullCommand.substring(0, 200));

      const proc = pty.spawn(shellCmd, shellArgs, {
        name: 'xterm-256color',
        cols: 200,
        rows: 30,
        cwd: safeCwd,
        env: env as { [key: string]: string },
      });

      this.currentProcess = proc;

      proc.onData((data: string) => {
        // Strip ANSI escape codes and control characters
        const clean = data
          .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')   // CSI sequences
          .replace(/\x1B\][^\x07]*\x07/g, '')         // OSC sequences with BEL
          .replace(/\x1B\][^\x1B]*\x1B\\/g, '');      // OSC sequences with ST
        output += clean;
      });

      proc.onExit(({ exitCode }) => {
        clearTimeout(timeoutId);
        this.currentProcess = null;

        if (this.isDisposed) {
          reject(new Error('Evaluator was disposed'));
          return;
        }

        if (exitCode !== 0 && exitCode !== null) {
          console.warn(`[ProgressEvaluator] Process exited with code ${exitCode}`);
        }

        resolve(output);
      });

      timeoutId = setTimeout(() => {
        console.warn('[ProgressEvaluator] Evaluation timed out after', EVALUATOR_TIMEOUT_MS, 'ms');
        try {
          proc.kill();
        } catch {
          /* ignore kill errors */
        }
        this.currentProcess = null;
        reject(new Error('Evaluator timed out'));
      }, EVALUATOR_TIMEOUT_MS);
    });
  }

  // ---------------------------------------------------------------------------
  // JSON parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse the evaluator CLI output into an EvaluationResult.
   * Uses three strategies in order:
   * 1. Extract from ```json ... ``` fenced code blocks
   * 2. Find the outermost { ... } in the output
   * 3. Parse individual JSON lines (stream format) looking for text messages
   *    that contain evaluation JSON
   */
  private parseEvaluatorResponse(output: string): EvaluationResult {
    const defaultResult: EvaluationResult = {
      done: false,
      summary: 'Evaluation failed to produce valid output',
      remaining: ['Unable to determine remaining work'],
      continuation_prompt:
        'Please continue working on the original task and finish all remaining items.',
      is_stuck: true,
    };

    if (!output.trim()) {
      console.warn('[ProgressEvaluator] Empty evaluator output');
      return defaultResult;
    }

    // Strategy 1: ```json ... ``` blocks
    const jsonBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      try {
        return this.validateResult(JSON.parse(jsonBlockMatch[1].trim()));
      } catch {
        /* try next strategy */
      }
    }

    // Strategy 2: Outermost { ... }
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return this.validateResult(JSON.parse(jsonMatch[0]));
      } catch {
        /* try next strategy */
      }
    }

    // Strategy 3: Parse stream JSON lines for text messages containing JSON
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);

          // Check if this is a stream text message wrapping evaluation JSON
          if (parsed.type === 'text' && parsed.part?.text) {
            const innerMatch = parsed.part.text.match(/\{[\s\S]*\}/);
            if (innerMatch) {
              try {
                return this.validateResult(JSON.parse(innerMatch[0]));
              } catch {
                /* continue */
              }
            }
          }

          // Try parsing the line itself as an EvaluationResult
          if ('done' in parsed) {
            return this.validateResult(parsed);
          }
        } catch {
          /* continue to next line */
        }
      }
    }

    console.warn('[ProgressEvaluator] Failed to parse evaluator output');
    return defaultResult;
  }

  /**
   * Normalize and validate a raw parsed object into a well-typed EvaluationResult.
   * Ensures all fields are present with correct types; uses safe defaults.
   */
  private validateResult(raw: Record<string, unknown>): EvaluationResult {
    return {
      done: typeof raw.done === 'boolean' ? raw.done : false,
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      remaining: Array.isArray(raw.remaining)
        ? raw.remaining.map(String)
        : [],
      continuation_prompt:
        typeof raw.continuation_prompt === 'string'
          ? raw.continuation_prompt
          : '',
      is_stuck: typeof raw.is_stuck === 'boolean' ? raw.is_stuck : false,
    };
  }

  // ---------------------------------------------------------------------------
  // Stuckness detection
  // ---------------------------------------------------------------------------

  /**
   * Detect stuckness by comparing remaining items with the previous evaluation.
   * If more than 80% of remaining items overlap, the agent is stuck.
   */
  private detectStuckness(result: EvaluationResult): boolean {
    if (this.evaluationHistory.length === 0) return false;

    const previous =
      this.evaluationHistory[this.evaluationHistory.length - 1];

    if (previous.remaining.length === 0 || result.remaining.length === 0) {
      return false;
    }

    const prevSet = new Set(
      previous.remaining.map((s) => s.toLowerCase().trim())
    );
    const currSet = new Set(
      result.remaining.map((s) => s.toLowerCase().trim())
    );

    let overlap = 0;
    for (const item of currSet) {
      if (prevSet.has(item)) overlap++;
    }

    const overlapRatio = overlap / Math.max(prevSet.size, currSet.size);
    return overlapRatio > 0.8;
  }

  // ---------------------------------------------------------------------------
  // Environment
  // ---------------------------------------------------------------------------

  /**
   * Build the environment variables for the evaluator process.
   * Mirrors the adapter's buildEnvironment() — sets up API keys,
   * bundled Node.js PATH, and relevant config variables.
   */
  private async buildEvaluatorEnvironment(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env };

    if (app.isPackaged) {
      env.ELECTRON_RUN_AS_NODE = '1';

      const bundledNode = getBundledNodePaths();
      if (bundledNode) {
        const delimiter = process.platform === 'win32' ? ';' : ':';
        env.PATH = `${bundledNode.binDir}${delimiter}${env.PATH || ''}`;
        env.NODE_BIN_PATH = bundledNode.binDir;
      }

      if (process.platform === 'darwin') {
        env.PATH = getExtendedNodePath(env.PATH);
      }
    }

    // Load all API keys
    const apiKeys = await getAllApiKeys();
    if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
    if (apiKeys.openai) env.OPENAI_API_KEY = apiKeys.openai;
    if (apiKeys.google) env.GOOGLE_GENERATIVE_AI_API_KEY = apiKeys.google;
    if (apiKeys.xai) env.XAI_API_KEY = apiKeys.xai;
    if (apiKeys.deepseek) env.DEEPSEEK_API_KEY = apiKeys.deepseek;
    if (apiKeys.zai) env.ZAI_API_KEY = apiKeys.zai;
    if (apiKeys.openrouter) env.OPENROUTER_API_KEY = apiKeys.openrouter;
    if (apiKeys.litellm) env.LITELLM_API_KEY = apiKeys.litellm;
    if (apiKeys.minimax) env.MINIMAX_API_KEY = apiKeys.minimax;

    // Set Bedrock credentials if configured
    const bedrockCredentials = getBedrockCredentials();
    if (bedrockCredentials) {
      if (bedrockCredentials.authType === 'accessKeys') {
        env.AWS_ACCESS_KEY_ID = bedrockCredentials.accessKeyId;
        env.AWS_SECRET_ACCESS_KEY = bedrockCredentials.secretAccessKey;
        if (bedrockCredentials.sessionToken) {
          env.AWS_SESSION_TOKEN = bedrockCredentials.sessionToken;
        }
      } else if (bedrockCredentials.authType === 'profile') {
        env.AWS_PROFILE = bedrockCredentials.profileName;
      }
      if (bedrockCredentials.region) {
        env.AWS_REGION = bedrockCredentials.region;
      }
    }

    // Pass through OpenCode config
    if (process.env.OPENCODE_CONFIG) {
      env.OPENCODE_CONFIG = process.env.OPENCODE_CONFIG;
    }

    return env;
  }

  // ---------------------------------------------------------------------------
  // Shell helpers (mirrored from adapter.ts)
  // ---------------------------------------------------------------------------

  /**
   * Escape a shell argument for safe execution.
   */
  private escapeShellArg(arg: string): string {
    if (process.platform === 'win32') {
      if (arg.includes(' ') || arg.includes('"')) {
        return `"${arg.replace(/"/g, '""')}"`;
      }
      return arg;
    } else {
      const needsEscaping = ["'", ' ', '$', '`', '\\', '"', '\n'].some(
        (c) => arg.includes(c)
      );
      if (needsEscaping) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    }
  }

  /**
   * Build a shell command string with properly escaped arguments.
   * On Windows, prepends & call operator for paths with spaces.
   */
  private buildShellCommand(command: string, args: string[]): string {
    const escapedCommand = this.escapeShellArg(command);
    const escapedArgs = args.map((a) => this.escapeShellArg(a));

    if (process.platform === 'win32' && escapedCommand.startsWith('"')) {
      return ['&', escapedCommand, ...escapedArgs].join(' ');
    }

    return [escapedCommand, ...escapedArgs].join(' ');
  }

  /**
   * Get platform-appropriate shell command.
   *
   * In packaged apps on macOS, uses /bin/sh to avoid loading user shell configs
   * (zsh always loads ~/.zshenv, which may trigger TCC permissions).
   */
  private getPlatformShell(): string {
    if (process.platform === 'win32') {
      return 'powershell.exe';
    } else if (app.isPackaged && process.platform === 'darwin') {
      return '/bin/sh';
    } else {
      const userShell = process.env.SHELL;
      if (userShell) return userShell;
      if (fs.existsSync('/bin/bash')) return '/bin/bash';
      if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
      return '/bin/sh';
    }
  }

  /**
   * Get shell arguments for running a command.
   * On Windows, uses -EncodedCommand with Base64-encoded UTF-16LE.
   */
  private getShellArgs(command: string): string[] {
    if (process.platform === 'win32') {
      const encodedCommand = Buffer.from(command, 'utf16le').toString(
        'base64'
      );
      return ['-NoProfile', '-EncodedCommand', encodedCommand];
    } else {
      return ['-c', command];
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Reset evaluation history for a new task. */
  reset(): void {
    this.evaluationHistory = [];
  }

  /** Dispose the evaluator and kill any running process. */
  dispose(): void {
    this.isDisposed = true;
    if (this.currentProcess) {
      try {
        this.currentProcess.kill();
      } catch {
        /* ignore kill errors */
      }
      this.currentProcess = null;
    }
  }
}
