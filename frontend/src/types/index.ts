export interface Message {
  id: string;
  content: string;
  timestamp: string;
}

export interface Transcript {
  id: string;
  text: string;
  timestamp: string; // Wall-clock time (e.g., "14:30:05")
  sequence_id?: number;
  chunk_start_time?: number; // Legacy field
  is_partial?: boolean;
  confidence?: number;
  // Recording-relative timestamps for playback sync
  audio_start_time?: number; // Seconds from recording start (e.g., 125.3)
  audio_end_time?: number;   // Seconds from recording start (e.g., 128.6)
  duration?: number;          // Segment duration in seconds (e.g., 3.3)
  // Speaker identification: "mic" or "system"
  speaker?: string;
}

export interface TranscriptUpdate {
  text: string;
  timestamp: string; // Wall-clock time for reference
  source: string;
  sequence_id: number;
  chunk_start_time: number; // Legacy field
  is_partial: boolean;
  confidence: number;
  // Recording-relative timestamps for playback sync
  audio_start_time: number; // Seconds from recording start
  audio_end_time: number;   // Seconds from recording start
  duration: number;          // Segment duration in seconds
  // Speaker identification: "mic" or "system"
  speaker?: string;
}

export interface Block {
  id: string;
  type: string;
  content: string;
  color: string;
}

export interface Section {
  title: string;
  blocks: Block[];
}

export interface Summary {
  [key: string]: Section;
}

export interface ApiResponse {
  message: string;
  num_chunks: number;
  data: any[];
}

export interface SummaryResponse {
  status: string;
  summary: Summary;
  raw_summary?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// BlockNote-specific types
export type SummaryFormat = 'legacy' | 'markdown' | 'blocknote';

export interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, any>;
  content?: any[];
  children?: BlockNoteBlock[];
}

export interface SummaryDataResponse {
  markdown?: string;
  summary_json?: BlockNoteBlock[];
  // Legacy format fields
  MeetingName?: string;
  _section_order?: string[];
  [key: string]: any; // For legacy section data
}

// Pagination types for optimized transcript loading
export interface MeetingMetadata {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder_path?: string;
}

export interface PaginatedTranscriptsResponse {
  transcripts: Transcript[];
  total_count: number;
  has_more: boolean;
}

// Transcript segment data for virtualized display
export interface TranscriptSegmentData {
  id: string;
  timestamp: number; // audio_start_time in seconds
  endTime?: number; // audio_end_time in seconds
  text: string;
  confidence?: number;
  speaker?: string; // "mic" or "system"
}

// Speaker management types
export interface MeetingSpeaker {
  id: string;
  meeting_id: string;
  speaker_key: string;
  display_name: string;
  suggested_by: string | null;
  created_at: string | null;
  color: string | null;
  sort_order: number | null;
}

export interface SpeakerSegmentCount {
  speaker: string;
  count: number;
}

// Meeting context types
export type MeetingContextType =
  | 'Sales Call'
  | 'Interview'
  | 'Team Standup'
  | '1-on-1'
  | 'Personal'
  | 'Brainstorm'
  | 'Presentation'
  | 'Custom';

export interface MeetingContext {
  context_type: string | null;
  context_notes: string | null;
}

// Communication grading types
export interface GradeCategory {
  name: string;
  score: number;
  feedback: string;
}

export interface GradeResult {
  overall_score: number;
  categories: GradeCategory[];
  strengths: string[];
  areas_for_improvement: string[];
  actionable_tips: string[];
}

export interface GradeResponse {
  id: string;
  status: 'idle' | 'pending' | 'completed' | 'failed';
  meeting_id: string;
  result: GradeResult | null;
  error: string | null;
}

// Grading configuration options
export interface GradingOptions {
  grade_target?: 'me' | 'other' | 'both';
  focus_areas?: string;
  user_role?: string;
}

// Chat types
export interface ChatSessionResponse {
  id: string;
  meeting_id: string | null;
  title: string | null;
  created_at: string;
}

export interface ChatMessageResponse {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface SendMessageResponse {
  message: ChatMessageResponse;
  response: string;
}
