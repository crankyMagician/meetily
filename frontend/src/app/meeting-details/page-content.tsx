"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Summary, SummaryResponse } from '@/types';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { GradePanel } from '@/components/MeetingDetails/GradePanel';
import { ChatPanel } from '@/components/MeetingDetails/ChatPanel';
import { MeetingContextSelector } from '@/components/MeetingContextSelector';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useGrading } from '@/hooks/meeting-details/useGrading';
import { useChat } from '@/hooks/meeting-details/useChat';
import { useConfig } from '@/contexts/ConfigContext';

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  updateSegmentSpeaker,
  audioPath,
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
  updateSegmentSpeaker?: (transcriptId: string, speaker: string | null) => void;
  meetingId?: string;
  audioPath?: string | null;
}) {
  console.log('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<string>('summary');

  // Meeting context state
  const [contextType, setContextType] = useState<string | null>(null);
  const [contextNotes, setContextNotes] = useState<string | null>(null);

  // Audio player
  const audio = useAudioPlayer(audioPath ?? null);

  // Review mode state
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const reviewEndTimeRef = useRef<number | null>(null);

  const unassignedSegments = useMemo(() =>
    (segments ?? []).filter((s: any) => !s.speaker), [segments]);

  const handlePlayFromTime = useCallback((time: number) => {
    audio.seek(time);
    audio.play();
  }, [audio]);

  // Review mode: auto-pause at segment end
  useEffect(() => {
    if (!isReviewMode || !audio.isPlaying || reviewEndTimeRef.current === null) return;
    if (audio.currentTime >= reviewEndTimeRef.current) {
      audio.pause();
    }
  }, [isReviewMode, audio.isPlaying, audio.currentTime]);

  const playReviewSegment = useCallback((index: number) => {
    if (index >= unassignedSegments.length) {
      setIsReviewMode(false);
      setReviewIndex(0);
      reviewEndTimeRef.current = null;
      toast.success('All segments reviewed');
      return;
    }
    const seg = unassignedSegments[index];
    reviewEndTimeRef.current = seg.endTime ?? (seg.timestamp + 10);
    handlePlayFromTime(seg.timestamp);
  }, [unassignedSegments, handlePlayFromTime]);

  const handleStartReview = useCallback(() => {
    if (unassignedSegments.length === 0) return;
    setIsReviewMode(true);
    setReviewIndex(0);
    playReviewSegment(0);
  }, [unassignedSegments, playReviewSegment]);

  const handleStopReview = useCallback(() => {
    setIsReviewMode(false);
    setReviewIndex(0);
    reviewEndTimeRef.current = null;
    audio.pause();
  }, [audio]);

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Sidebar context
  const { serverAddress } = useSidebar();

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log('📝 Registering modal open function in PageContent');
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log('🔔 Opening model settings from PageContent');
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn('⚠️ Modal open function not yet registered');
    }
  };

  // Save model config to backend database and sync via event
  const handleSaveModelConfig = async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      // Emit event so ConfigContext and other listeners stay in sync
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error('Failed to save model settings');
    }
  };

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false, // ConfigContext loads on mount
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  // Grading hook
  const grading = useGrading({
    meetingId: meeting.id,
    modelConfig,
  });

  // Chat hook
  const chat = useChat({
    meetingId: meeting.id,
    modelConfig,
  });

  // Speaker change handler (cycles speaker on click)
  const handleSpeakerChange = useCallback(async (segmentId: string, newSpeaker: string | null) => {
    // Optimistic update
    updateSegmentSpeaker?.(segmentId, newSpeaker);

    try {
      await invoke('api_update_transcript_speaker', {
        transcriptId: segmentId,
        speaker: newSpeaker,
      });
    } catch (error) {
      console.error('Failed to update speaker:', error);
      toast.error('Failed to update speaker');
    }
  }, [updateSegmentSpeaker]);

  // Review mode: assign speaker and advance
  const handleReviewAssign = useCallback((speaker: string) => {
    const seg = unassignedSegments[reviewIndex];
    if (seg) {
      handleSpeakerChange(seg.id, speaker);
    }
    const nextIndex = reviewIndex + 1;
    setReviewIndex(nextIndex);
    playReviewSegment(nextIndex);
  }, [unassignedSegments, reviewIndex, playReviewSegment, handleSpeakerChange]);

  const handleReviewSkip = useCallback(() => {
    const nextIndex = reviewIndex + 1;
    setReviewIndex(nextIndex);
    playReviewSegment(nextIndex);
  }, [reviewIndex, playReviewSegment]);

  // Bulk assign all unassigned speakers
  const handleBulkAssignSpeaker = useCallback(async (speaker: string) => {
    try {
      const count = await invoke<number>('api_set_unassigned_speakers', {
        meetingId: meeting.id,
        speaker,
      });
      // Update local state for all unassigned segments
      segments?.forEach(s => {
        if (!s.speaker) {
          updateSegmentSpeaker?.(s.id, speaker);
        }
      });
      toast.success(`Assigned ${count} segments as ${speaker === 'mic' ? 'You' : 'Other'}`);
    } catch (error) {
      console.error('Failed to bulk assign speakers:', error);
      toast.error('Failed to assign speakers');
    }
  }, [meeting.id, segments, updateSegmentSpeaker]);

  // Load meeting context on mount
  useEffect(() => {
    const loadContext = async () => {
      try {
        const ctx = await invoke<{ context_type: string | null; context_notes: string | null }>(
          'api_get_meeting_context',
          { meetingId: meeting.id }
        );
        setContextType(ctx.context_type);
        setContextNotes(ctx.context_notes);
      } catch (error) {
        console.error('Failed to load meeting context:', error);
      }
    };
    loadContext();
  }, [meeting.id]);

  // Track page view
  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  // Auto-generate summary when flag is set
  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled) {
        console.log(`🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`);
        await summaryGeneration.handleGenerateSummary('');

        // Notify parent that auto-generation is complete (only if not cancelled)
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();

    // Cleanup: cancel if component unmounts or meeting changes
    return () => {
      cancelled = true;
    };
  }, [shouldAutoGenerate, meeting.id]); // Re-run if meeting changes

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-gray-50"
    >
      <div className="flex flex-1 overflow-hidden">
        <TranscriptPanel
          transcripts={meetingData.transcripts}
          customPrompt={customPrompt}
          onPromptChange={setCustomPrompt}
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
          isRecording={isRecording}
          disableAutoScroll={true}
          // Pagination props for efficient loading
          usePagination={true}
          segments={segments}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          onSpeakerChange={handleSpeakerChange}
          onBulkAssignSpeaker={handleBulkAssignSpeaker}
          // Audio playback props
          audioIsPlaying={audio.isPlaying}
          audioCurrentTime={audio.currentTime}
          audioDuration={audio.duration}
          audioError={audio.error}
          onAudioPlay={audio.play}
          onAudioPause={audio.pause}
          onAudioSeek={audio.seek}
          onPlaySegment={handlePlayFromTime}
          // Review mode props
          isReviewMode={isReviewMode}
          onStartReview={handleStartReview}
          onStopReview={handleStopReview}
          onReviewAssignSpeaker={handleReviewAssign}
          onReviewSkipSegment={handleReviewSkip}
        />
        <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
          {/* Context selector + Tabs header */}
          <div className="px-4 pt-3 pb-0 border-b border-gray-200 space-y-2">
            <div className="flex items-center justify-between">
              <MeetingContextSelector
                meetingId={meeting.id}
                initialContextType={contextType}
                initialContextNotes={contextNotes}
                compact={true}
                onChange={(type, notes) => {
                  setContextType(type);
                  setContextNotes(notes);
                }}
              />
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="grade">Grade</TabsTrigger>
                <TabsTrigger value="chat">Chat</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab === 'summary' && (
              <SummaryPanel
                meeting={meeting}
                meetingTitle={meetingData.meetingTitle}
                onTitleChange={meetingData.handleTitleChange}
                isEditingTitle={meetingData.isEditingTitle}
                onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
                onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
                isTitleDirty={meetingData.isTitleDirty}
                summaryRef={meetingData.blockNoteSummaryRef}
                isSaving={meetingData.isSaving}
                onSaveAll={meetingData.saveAllChanges}
                onCopySummary={copyOperations.handleCopySummary}
                onOpenFolder={meetingOperations.handleOpenMeetingFolder}
                aiSummary={meetingData.aiSummary}
                summaryStatus={summaryGeneration.summaryStatus}
                transcripts={meetingData.transcripts}
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                onSaveModelConfig={handleSaveModelConfig}
                onGenerateSummary={summaryGeneration.handleGenerateSummary}
                onStopGeneration={summaryGeneration.handleStopGeneration}
                customPrompt={customPrompt}
                summaryResponse={summaryResponse}
                onSaveSummary={meetingData.handleSaveSummary}
                onSummaryChange={meetingData.handleSummaryChange}
                onDirtyChange={meetingData.setIsSummaryDirty}
                summaryError={summaryGeneration.summaryError}
                onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
                getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
                availableTemplates={templates.availableTemplates}
                selectedTemplate={templates.selectedTemplate}
                onTemplateSelect={templates.handleTemplateSelection}
                isModelConfigLoading={false}
                onOpenModelSettings={handleRegisterModalOpen}
              />
            )}
            {activeTab === 'grade' && (
              <GradePanel
                status={grading.gradeStatus}
                result={grading.gradeResult}
                error={grading.gradeError}
                onGenerate={grading.generateGrade}
              />
            )}
            {activeTab === 'chat' && (
              <ChatPanel
                messages={chat.messages}
                isLoading={chat.isLoading}
                isSending={chat.isSending}
                onSendMessage={chat.sendMessage}
                meetingId={meeting.id}
              />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
