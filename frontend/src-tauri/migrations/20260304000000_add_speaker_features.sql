-- Add user display name to settings
ALTER TABLE settings ADD COLUMN userDisplayName TEXT;

-- Add speaker field to transcripts (mic/system source identification)
-- Note: 20251110000001_add_speaker_field.sql may have already added this column
-- Using a safe approach that won't fail if column exists
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we handle this in code

-- Meeting speakers table for LLM-suggested and user-assigned speaker names
CREATE TABLE IF NOT EXISTS meeting_speakers (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    speaker_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    suggested_by TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    UNIQUE(meeting_id, speaker_key)
);

-- Add grading configuration fields to communication_grades
ALTER TABLE communication_grades ADD COLUMN grade_target TEXT DEFAULT 'me';
ALTER TABLE communication_grades ADD COLUMN focus_areas TEXT;
ALTER TABLE communication_grades ADD COLUMN user_role TEXT;
