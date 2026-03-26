import { useTranslation } from 'react-i18next';
import { XCircle, ArrowBendDownLeft, WarningCircle } from '@phosphor-icons/react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ModelIndicator } from '../../components/ui/ModelIndicator';
import { SpeechInputButton } from '../../components/ui/SpeechInputButton';
import { PlusMenu } from '../../components/landing/PlusMenu';
import { SlashCommandPopover } from '../../components/landing/SlashCommandPopover';
import type { FileAttachmentInfo } from '@accomplish_ai/agent-core/common';
import { getAttachmentIcon } from '../../lib/attachments';
import type { useSpeechInput } from '../../hooks/useSpeechInput';
import type { useSlashCommand } from '../../hooks/useSlashCommand';
import type { Task } from '@accomplish_ai/agent-core/common';

interface FollowUpInputProps {
  followUp: string;
  setFollowUp: (v: string) => void;
  isFollowUpOverLimit: boolean;
  attachments: FileAttachmentInfo[];
  setAttachments: (updater: (prev: FileAttachmentInfo[]) => FileAttachmentInfo[]) => void;
  removeAttachment: (id: string) => void;
  isDragging: boolean;
  setDragCounter: React.Dispatch<React.SetStateAction<number>>;
  setIsDragging: (v: boolean) => void;
  handleDrop: (e: React.DragEvent) => void;
  handlePickFiles: () => void;
  speechInput: ReturnType<typeof useSpeechInput>;
  slashCommand: ReturnType<typeof useSlashCommand>;
  followUpInputRef: React.RefObject<HTMLTextAreaElement | null>;
  handleFollowUp: () => void;
  isLoading: boolean;
  currentTask: Task;
  hasSession: string | boolean | null | undefined;
  onOpenSettings: (tab: 'providers' | 'voice' | 'skills' | 'connectors') => void;
  onOpenModelSettings: () => void;
  onOpenSpeechSettings: () => void;
}

/** Follow-up input bar shown when the user can send a message. */
export function FollowUpInput(props: FollowUpInputProps) {
  const { tCommon } = { tCommon: useTranslation('common').t };
  const { t } = useTranslation('execution');
  const {
    followUp,
    setFollowUp,
    isFollowUpOverLimit,
    attachments,
    removeAttachment,
    isDragging,
    setDragCounter,
    setIsDragging,
    handleDrop,
    handlePickFiles,
    speechInput,
    slashCommand,
    followUpInputRef,
    handleFollowUp,
    isLoading,
    currentTask,
    hasSession,
    onOpenSettings,
    onOpenModelSettings,
    onOpenSpeechSettings,
  } = props;

  return (
    <div
      className="flex-shrink-0 border-t border-border bg-card/50 px-6 py-4 relative"
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setDragCounter((prev) => prev + 1);
        if (!isDragging) {
          setIsDragging(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragCounter((prev) => {
          const next = prev - 1;
          if (next === 0) {
            setIsDragging(false);
          }
          return next;
        });
      }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
        >
          <div className="text-primary font-medium flex items-center gap-2 pointer-events-none">
            Drop files to attach
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto space-y-2">
        {speechInput.error && (
          <Alert
            variant="destructive"
            className="py-2 px-3 flex items-center gap-2 [&>svg]:static [&>svg~*]:pl-0"
          >
            <WarningCircle className="h-4 w-4" />
            <AlertDescription className="text-xs leading-tight">
              {speechInput.error.message}
              {speechInput.error.code === 'EMPTY_RESULT' && (
                <button
                  onClick={() => speechInput.retry()}
                  className="ml-2 underline hover:no-underline"
                  type="button"
                >
                  {tCommon('buttons.retry')}
                </button>
              )}
            </AlertDescription>
          </Alert>
        )}
        <div className="rounded-xl border border-border bg-background shadow-sm transition-all duration-200 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          {attachments.length > 0 && (
            <div className="px-4 pt-4 pb-1 flex gap-2 overflow-x-auto items-center">
              {attachments.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 border border-border rounded-md shrink-0 max-w-[200px]"
                  title={file.name}
                >
                  {getAttachmentIcon(file.type)}
                  <span className="text-xs font-medium truncate">{file.name}</span>
                  <button
                    onClick={() => removeAttachment(file.id)}
                    aria-label={`Remove attachment ${file.name}`}
                    className="text-muted-foreground hover:text-foreground shrink-0 ml-1 rounded-full p-0.5 hover:bg-muted"
                  >
                    <XCircle className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="px-4 pt-3 pb-2 relative">
            <textarea
              ref={followUpInputRef}
              value={followUp}
              onChange={(e) => {
                setFollowUp(e.target.value);
                slashCommand.handleChange(e.target.value, e.target.selectionStart);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  return;
                }
                if (slashCommand.handleKeyDown(e)) {
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleFollowUp();
                }
              }}
              placeholder={
                currentTask.status === 'interrupted'
                  ? hasSession
                    ? t('followUp.interruptedPlaceholder')
                    : t('followUp.noSessionPlaceholder')
                  : currentTask.status === 'completed'
                    ? t('followUp.completedPlaceholder')
                    : t('followUp.defaultPlaceholder')
              }
              disabled={isLoading || speechInput.isRecording}
              rows={1}
              className="w-full max-h-[160px] resize-none bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="execution-follow-up-input"
            />
            <SlashCommandPopover
              isOpen={slashCommand.state.isOpen}
              skills={slashCommand.state.filteredSkills}
              selectedIndex={slashCommand.state.selectedIndex}
              query={slashCommand.state.query}
              textareaRef={followUpInputRef}
              triggerStart={slashCommand.state.triggerStart}
              onSelect={slashCommand.selectSkill}
              onDismiss={slashCommand.dismiss}
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/50">
            <PlusMenu
              onSkillSelect={(command) => {
                setFollowUp(`${command} ${followUp}`.trim());
                setTimeout(() => followUpInputRef.current?.focus(), 0);
              }}
              onAttachFiles={handlePickFiles}
              onOpenSettings={onOpenSettings}
              disabled={isLoading || speechInput.isRecording}
            />
            <div className="flex items-center gap-2">
              <ModelIndicator isRunning={false} onOpenSettings={onOpenModelSettings} />
              <div className="w-px h-6 bg-border flex-shrink-0" />
              <SpeechInputButton
                isRecording={speechInput.isRecording}
                isTranscribing={speechInput.isTranscribing}
                recordingDuration={speechInput.recordingDuration}
                error={speechInput.error}
                isConfigured={speechInput.isConfigured}
                disabled={isLoading}
                onStartRecording={() => speechInput.startRecording()}
                onStopRecording={() => speechInput.stopRecording()}
                onRetry={() => speechInput.retry()}
                onOpenSettings={onOpenSpeechSettings}
                size="md"
              />
              <button
                type="button"
                onClick={handleFollowUp}
                disabled={
                  (!followUp.trim() && attachments.length === 0) ||
                  isLoading ||
                  speechInput.isRecording ||
                  isFollowUpOverLimit
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={tCommon('buttons.send')}
              >
                <ArrowBendDownLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
