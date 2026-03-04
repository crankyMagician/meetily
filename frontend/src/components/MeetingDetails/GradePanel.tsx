"use client";

import { useState } from 'react';
import { GradeResult, GradingOptions } from '@/types';
import { LoaderIcon, Award, TrendingUp, Lightbulb, Target } from 'lucide-react';

interface GradePanelProps {
  status: 'idle' | 'pending' | 'completed' | 'failed';
  result: GradeResult | null;
  error: string | null;
  onGenerate: (options?: GradingOptions) => void;
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-yellow-500' : score >= 4 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600 w-40 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full ${color} transition-all duration-500`}
          style={{ width: `${score * 10}%` }}
        />
      </div>
      <span className="text-sm font-medium text-gray-700 w-8 text-right">{score}</span>
    </div>
  );
}

function OverallScore({ score }: { score: number }) {
  const color = score >= 8 ? 'text-green-600' : score >= 6 ? 'text-yellow-600' : score >= 4 ? 'text-orange-600' : 'text-red-600';
  const bgColor = score >= 8 ? 'bg-green-50' : score >= 6 ? 'bg-yellow-50' : score >= 4 ? 'bg-orange-50' : 'bg-red-50';
  const borderColor = score >= 8 ? 'border-green-200' : score >= 6 ? 'border-yellow-200' : score >= 4 ? 'border-orange-200' : 'border-red-200';

  return (
    <div className={`flex items-center justify-center p-6 rounded-xl ${bgColor} border ${borderColor}`}>
      <div className="text-center">
        <div className={`text-5xl font-bold ${color}`}>{score}</div>
        <div className="text-sm text-gray-500 mt-1">out of 10</div>
      </div>
    </div>
  );
}

function GradingConfigForm({ onSubmit }: { onSubmit: (options: GradingOptions) => void }) {
  const [gradeTarget, setGradeTarget] = useState<'me' | 'other' | 'both'>('me');
  const [userRole, setUserRole] = useState('');
  const [focusAreas, setFocusAreas] = useState('');

  return (
    <div className="space-y-4">
      {/* Grade Target */}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Who to grade</label>
        <div className="flex gap-2">
          {([
            { value: 'me' as const, label: 'Grade me' },
            { value: 'other' as const, label: 'Other participant' },
            { value: 'both' as const, label: 'Grade both' },
          ]).map((option) => (
            <button
              key={option.value}
              onClick={() => setGradeTarget(option.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                gradeTarget === option.value
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Your Role */}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Your role (optional)</label>
        <input
          type="text"
          value={userRole}
          onChange={(e) => setUserRole(e.target.value)}
          placeholder="e.g., Sales rep, Interviewer, Manager"
          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Focus Areas */}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Focus areas (optional)</label>
        <textarea
          value={focusAreas}
          onChange={(e) => setFocusAreas(e.target.value)}
          placeholder="e.g., How well I handled the pricing objection, clarity of my technical explanation"
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      <button
        onClick={() => onSubmit({
          grade_target: gradeTarget,
          user_role: userRole || undefined,
          focus_areas: focusAreas || undefined,
        })}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        Generate Grade
      </button>
    </div>
  );
}

export function GradePanel({ status, result, error, onGenerate }: GradePanelProps) {
  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <Award className="w-10 h-10 text-gray-300 mb-3" />
        <h3 className="text-lg font-medium text-gray-700 mb-1">Communication Grade</h3>
        <p className="text-sm text-gray-500 mb-5 max-w-sm text-center">
          Get AI-powered feedback on communication skills based on this meeting&apos;s transcript.
        </p>
        <div className="w-full max-w-sm">
          <GradingConfigForm onSubmit={onGenerate} />
        </div>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <LoaderIcon className="w-8 h-8 animate-spin text-blue-500 mb-4" />
        <p className="text-sm text-gray-600">Analyzing communication...</p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <p className="text-sm text-red-500 mb-4">{error || 'Grade generation failed'}</p>
        <button
          onClick={() => onGenerate()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-5">
      {/* Overall Score */}
      <OverallScore score={result.overall_score} />

      {/* Category Breakdown */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
          <Target className="w-4 h-4" />
          Category Scores
        </h4>
        <div className="space-y-2.5">
          {result.categories.map((cat) => (
            <div key={cat.name}>
              <ScoreBar score={cat.score} label={cat.name} />
              {cat.feedback && (
                <p className="text-xs text-gray-500 ml-[172px] mt-0.5">{cat.feedback}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Strengths */}
      {result.strengths.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" />
            Strengths
          </h4>
          <ul className="space-y-1.5">
            {result.strengths.map((s, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-green-500 mt-0.5">+</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Areas for Improvement */}
      {result.areas_for_improvement.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-1.5">
            <Target className="w-4 h-4" />
            Areas to Improve
          </h4>
          <ul className="space-y-1.5">
            {result.areas_for_improvement.map((a, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-orange-500 mt-0.5">-</span>
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actionable Tips */}
      {result.actionable_tips.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4" />
            Actionable Tips
          </h4>
          <ul className="space-y-1.5">
            {result.actionable_tips.map((t, i) => (
              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                <span className="text-blue-500 font-medium mt-0.5">{i + 1}.</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Regenerate */}
      <div className="pt-2 border-t border-gray-100">
        <button
          onClick={() => onGenerate()}
          className="text-xs text-gray-500 hover:text-blue-600 transition-colors"
        >
          Regenerate grade
        </button>
      </div>
    </div>
  );
}
