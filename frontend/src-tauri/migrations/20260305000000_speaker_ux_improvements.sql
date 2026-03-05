-- Add color and sort_order columns to meeting_speakers for speaker management UX
ALTER TABLE meeting_speakers ADD COLUMN color TEXT;
ALTER TABLE meeting_speakers ADD COLUMN sort_order INTEGER DEFAULT 0;
