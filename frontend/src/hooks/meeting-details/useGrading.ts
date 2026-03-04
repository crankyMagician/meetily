import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GradeResponse, GradeResult } from '@/types';
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
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const response = await invoke<GradeResponse>('api_get_grade', {
          meetingId,
          gradeId: id,
        });

        if (response.status === 'completed' && response.result) {
          setGradeStatus('completed');
          setGradeResult(response.result);
          setGradeError(null);
          stopPolling();
          toast.success('Communication grade ready!');
        } else if (response.status === 'failed') {
          setGradeStatus('failed');
          setGradeError(response.error || 'Grade generation failed');
          stopPolling();
          toast.error('Grade generation failed', {
            description: response.error || undefined,
          });
        }
      } catch (error) {
        console.error('Error polling grade:', error);
      }
    }, 2000);
  }, [meetingId, stopPolling]);

  const generateGrade = useCallback(async () => {
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
