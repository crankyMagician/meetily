import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GradeResponse, GradeResult, GradingOptions } from '@/types';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { toast } from 'sonner';

interface UseGradingProps {
  meetingId: string;
  modelConfig: ModelConfig;
}

export function useGrading({ meetingId, modelConfig }: UseGradingProps) {
  const [gradeStatus, setGradeStatus] = useState<'idle' | 'pending' | 'completed' | 'failed'>('idle');
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [gradeId, setGradeId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch existing grade on mount
  useEffect(() => {
    const fetchGrade = async () => {
      try {
        const response = await invoke<GradeResponse>('api_get_grade', {
          meetingId,
          gradeId: null,
        });
        if (response.status === 'completed' && response.result) {
          setGradeStatus('completed');
          setGradeResult(response.result);
          setGradeId(response.id);
        } else if (response.status === 'pending') {
          setGradeStatus('pending');
          setGradeId(response.id);
          startPolling(response.id);
        } else if (response.status === 'failed') {
          setGradeStatus('failed');
          setGradeError(response.error || 'Grade generation failed');
        }
      } catch (error) {
        // No grade exists yet, that's fine
      }
    };
    fetchGrade();

    return () => stopPolling();
  }, [meetingId]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    stopPolling();
    let delay = 2000;
    const MAX_DELAY = 10000;

    const poll = async () => {
      try {
        const response = await invoke<GradeResponse>('api_get_grade', {
          meetingId,
          gradeId: id,
        });

        if (response.status === 'completed' && response.result) {
          setGradeStatus('completed');
          setGradeResult(response.result);
          setGradeError(null);
          pollingRef.current = null;
          toast.success('Communication grade ready!');
          return;
        } else if (response.status === 'failed') {
          setGradeStatus('failed');
          setGradeError(response.error || 'Grade generation failed');
          pollingRef.current = null;
          toast.error('Grade generation failed', {
            description: response.error || undefined,
          });
          return;
        }
      } catch (error) {
        console.error('Error polling grade:', error);
      }
      delay = Math.min(delay * 1.5, MAX_DELAY);
      pollingRef.current = setTimeout(poll, delay);
    };

    pollingRef.current = setTimeout(poll, delay);
  }, [meetingId, stopPolling]);

  const generateGrade = useCallback(async (options?: GradingOptions) => {
    setGradeStatus('pending');
    setGradeError(null);

    try {
      toast.info('Generating communication grade...', {
        description: `Using ${modelConfig.provider}/${modelConfig.model}`,
        duration: 3000,
      });

      const response = await invoke<GradeResponse>('api_generate_grade', {
        meetingId,
        model: modelConfig.provider,
        modelName: modelConfig.model,
        gradingOptions: options || null,
      });

      setGradeId(response.id);
      startPolling(response.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setGradeStatus('failed');
      setGradeError(msg);
      toast.error('Failed to start grade generation', { description: msg });
    }
  }, [meetingId, modelConfig, startPolling]);

  return {
    gradeStatus,
    gradeResult,
    gradeError,
    generateGrade,
  };
}
