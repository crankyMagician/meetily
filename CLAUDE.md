# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Meetily** is a privacy-first AI meeting assistant that captures, transcribes, and summarizes meetings entirely on local infrastructure. The project consists of two main components:

1. **Frontend**: Tauri-based desktop application (Rust + Next.js + TypeScript)
2. **Backend**: FastAPI server for meeting storage and LLM-based summarization (Python)

### Key Technology Stack
- **Desktop App**: Tauri 2.x (Rust) + Next.js 14 + React 18
- **Audio Processing**: Rust (cpal, whisper-rs, professional audio mixing)
- **Transcription**: Whisper.cpp (local, GPU-accelerated)
- **Backend API**: FastAPI + SQLite (aiosqlite)
- **LLM Integration**: Ollama (local), Claude, Groq, OpenRouter
- **Theming**: `next-themes` (light/dark/system), CSS custom properties, Tailwind `darkMode: 'class'`

## Essential Development Commands

### Frontend Development (Tauri Desktop App)

**Location**: `/frontend`

```bash
# macOS Development
./clean_run.sh              # Clean build and run with info logging
./clean_run.sh debug        # Run with debug logging
./clean_build.sh            # Production build (full clean)
./rebuild_install.sh        # Quick rebuild + install to /Applications (incremental, much faster)

# Windows Development
clean_run_windows.bat       # Clean build and run
clean_build_windows.bat     # Production build

# Manual Commands
pnpm install                # Install dependencies
pnpm run dev                # Next.js dev server (port 3118)
pnpm run tauri:dev          # Full Tauri development mode
pnpm run tauri:build        # Production build

# GPU-Specific Builds (for testing acceleration)
pnpm run tauri:dev:metal    # macOS Metal GPU
pnpm run tauri:dev:cuda     # NVIDIA CUDA
pnpm run tauri:dev:vulkan   # AMD/Intel Vulkan
pnpm run tauri:dev:cpu      # CPU-only (no GPU)
```

### Backend Development (FastAPI Server)

**Location**: `/backend`

```bash
# macOS
./build_whisper.sh small              # Build Whisper with 'small' model
./clean_start_backend.sh              # Start FastAPI server (port 5167)

# Windows
build_whisper.cmd small               # Build Whisper with model
start_with_output.ps1                 # Interactive setup and start
clean_start_backend.cmd               # Start server

# Docker (Cross-Platform)
./run-docker.sh start --interactive   # Interactive setup (macOS/Linux)
.\run-docker.ps1 start -Interactive   # Interactive setup (Windows)
./run-docker.sh logs --service app    # View logs
```

**Available Whisper Models**: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v1`, `large-v2`, `large-v3`, `large-v3-turbo`

### Service Endpoints
- **Whisper Server**: http://localhost:8178
- **Backend API**: http://localhost:5167
- **Backend Docs**: http://localhost:5167/docs
- **Frontend Dev**: http://localhost:3118

## High-Level Architecture

### Three-Tier System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Tauri Desktop App)                  │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │   Next.js UI     │  │  Rust Backend   │  │ Whisper Engine │ │
│  │  (React/TS)      │←→│  (Audio + IPC)  │←→│  (Local STT)   │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
│         ↑ Tauri Events           ↑ Audio Pipeline               │
└─────────┼────────────────────────┼─────────────────────────────┘
          │ HTTP/WebSocket         │
          ↓                        │
┌─────────────────────────────────┼─────────────────────────────┐
│              Backend (FastAPI)  │                              │
│  ┌────────────┐  ┌─────────────┴──────┐  ┌────────────────┐  │
│  │   SQLite   │←→│  Meeting Manager   │←→│  LLM Provider  │  │
│  │ (Meetings) │  │  (CRUD + Summary)  │  │ (Ollama/etc.)  │  │
│  └────────────┘  └────────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Audio Processing Pipeline (Critical Understanding)

The audio system has **two parallel paths** with different purposes:

```
Raw Audio (Mic + System)
         ↓
┌────────────────────────────────────────────────────────────┐
│              Audio Pipeline Manager                         │
│  (frontend/src-tauri/src/audio/pipeline.rs)                │
└─────────────┬──────────────────────────┬───────────────────┘
              ↓                          ↓
    ┌─────────────────┐        ┌─────────────────────┐
    │ Recording Path  │        │ Transcription Path  │
    │ (Pre-mixed)     │        │ (VAD-filtered)      │
    └─────────────────┘        └─────────────────────┘
              ↓                          ↓
    RecordingSaver.save()      WhisperEngine.transcribe()
```

**Key Insight**: The pipeline performs **professional audio mixing** (RMS-based ducking, clipping prevention) for recording, while simultaneously applying **Voice Activity Detection (VAD)** to send only speech segments to Whisper for transcription.

### Audio Device Modularization (Recently Completed)

**Context**: The audio system was refactored from a monolithic 1028-line `core.rs` file into focused modules. See [AUDIO_MODULARIZATION_PLAN.md](AUDIO_MODULARIZATION_PLAN.md) for details.

```
audio/
├── devices/                    # Device discovery and configuration
│   ├── discovery.rs           # list_audio_devices, trigger_audio_permission
│   ├── microphone.rs          # default_input_device
│   ├── speakers.rs            # default_output_device
│   ├── configuration.rs       # AudioDevice types, parsing
│   └── platform/              # Platform-specific implementations
│       ├── windows.rs         # WASAPI logic (~200 lines)
│       ├── macos.rs           # ScreenCaptureKit logic
│       └── linux.rs           # ALSA/PulseAudio logic
├── capture/                   # Audio stream capture
│   ├── microphone.rs          # Microphone capture stream
│   ├── system.rs              # System audio capture stream
│   └── core_audio.rs          # macOS ScreenCaptureKit integration
├── pipeline.rs                # Audio mixing and VAD processing
├── recording_manager.rs       # High-level recording coordination
├── recording_commands.rs      # Tauri command interface
└── recording_saver.rs         # Audio file writing
```

**When working on audio features**:
- Device detection issues → `devices/discovery.rs` or `devices/platform/{windows,macos,linux}.rs`
- Microphone/speaker problems → `devices/microphone.rs` or `devices/speakers.rs`
- Audio capture issues → `capture/microphone.rs` or `capture/system.rs`
- Mixing/processing problems → `pipeline.rs`
- Recording workflow → `recording_manager.rs`

### Rust ↔ Frontend Communication (Tauri Architecture)

**Command Pattern** (Frontend → Rust):
```typescript
// Frontend: src/app/page.tsx
await invoke('start_recording', {
  mic_device_name: "Built-in Microphone",
  system_device_name: "BlackHole 2ch",
  meeting_name: "Team Standup"
});
```

```rust
// Rust: src/lib.rs
#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>
) -> Result<(), String> {
    // Implementation delegates to audio::recording_commands
}
```

**Event Pattern** (Rust → Frontend):
```rust
// Rust: Emit transcript updates
app.emit("transcript-update", TranscriptUpdate {
    text: "Hello world".to_string(),
    timestamp: chrono::Utc::now(),
    // ...
})?;
```

```typescript
// Frontend: Listen for events
await listen<TranscriptUpdate>('transcript-update', (event) => {
  setTranscripts(prev => [...prev, event.payload]);
});
```

### Whisper Model Management

**Model Storage Locations**:
- **Development**: `frontend/models/` or `backend/whisper-server-package/models/`
- **Production (macOS)**: `~/Library/Application Support/Meetily/models/`
- **Production (Windows)**: `%APPDATA%\Meetily\models\`

**Model Loading** (frontend/src-tauri/src/whisper_engine/whisper_engine.rs):
```rust
pub async fn load_model(&self, model_name: &str) -> Result<()> {
    // Automatically detects GPU capabilities (Metal/CUDA/Vulkan)
    // Falls back to CPU if GPU unavailable
}
```

**GPU Acceleration**:
- **macOS**: Metal + CoreML (automatically enabled)
- **Windows/Linux**: CUDA (NVIDIA), Vulkan (AMD/Intel), or CPU
- Configure via Cargo features: `--features cuda`, `--features vulkan`

## Critical Development Patterns

### 1. Audio Buffer Management

**Ring Buffer Mixing** (pipeline.rs):
- Mic and system audio arrive asynchronously at different rates
- Ring buffer accumulates samples until both streams have aligned windows (50ms)
- Professional mixing applies RMS-based ducking to prevent system audio from drowning out microphone
- Uses `VecDeque` for efficient windowed processing

### 2. Thread Safety and Async Boundaries

**Recording State** (recording_state.rs):
```rust
pub struct RecordingState {
    is_recording: Arc<AtomicBool>,
    audio_sender: Arc<RwLock<Option<mpsc::UnboundedSender<AudioChunk>>>>,
    // ...
}
```

**Key Pattern**: Use `Arc<RwLock<T>>` for shared state across async tasks, `Arc<AtomicBool>` for simple flags.

### 3. Error Handling and Logging

**Performance-Aware Logging** (lib.rs):
```rust
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => { log::debug!($($arg)*) };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};  // Zero overhead in release builds
}
```

**Usage**: Use `perf_debug!()` and `perf_trace!()` for hot-path logging that should be eliminated in production.

### 4. Frontend State Management

**Sidebar Context** (components/Sidebar/SidebarProvider.tsx):
- Global state for meetings list, current meeting, recording status
- Communicates with backend API (http://localhost:5167)
- Manages WebSocket connections for real-time updates

**Pattern**: Tauri commands update Rust state → Emit events → Frontend listeners update React state → Context propagates to components

## Common Development Tasks

### Adding a New Audio Device Platform

1. Create platform file: `audio/devices/platform/{platform_name}.rs`
2. Implement device enumeration for the platform
3. Add platform-specific configuration in `audio/devices/configuration.rs`
4. Update `audio/devices/platform/mod.rs` to export new platform functions
5. Test with `cargo check` and platform-specific device tests

### Adding a New Tauri Command

1. Define command in `src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn my_command(arg: String) -> Result<String, String> { /* ... */ }
   ```
2. Register in `tauri::Builder`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       start_recording,
       my_command,  // Add here
   ])
   ```
3. Call from frontend:
   ```typescript
   const result = await invoke<string>('my_command', { arg: 'value' });
   ```

### Modifying Audio Pipeline Behavior

**Location**: `frontend/src-tauri/src/audio/pipeline.rs`

Key components:
- `AudioMixerRingBuffer`: Manages mic + system audio synchronization
- `ProfessionalAudioMixer`: RMS-based ducking and mixing
- `AudioPipelineManager`: Orchestrates VAD, mixing, and distribution

**Testing Audio Changes**:
```bash
# Enable verbose audio logging
RUST_LOG=app_lib::audio=debug ./clean_run.sh

# Monitor audio metrics in real-time
# Check Developer Console in the app (Cmd+Shift+I on macOS)
```

### Backend API Development

**Adding New Endpoints** (backend/app/main.py):
```python
@app.post("/api/my-endpoint")
async def my_endpoint(request: MyRequest) -> MyResponse:
    # Use DatabaseManager for persistence
    db = DatabaseManager()
    result = await db.some_operation()
    return result
```

**Database Operations** (backend/app/db.py):
- All meeting data stored in SQLite
- Use `DatabaseManager` class for all DB operations
- Async operations with `aiosqlite`

## Testing

### Running Tests

```bash
# Rust tests (from frontend/src-tauri/)
cargo test --lib                    # All Rust unit tests
cargo test --lib -- speaker         # Filter to speaker-related tests
cargo test --lib -- transcript      # Filter to transcript-related tests

# TypeScript tests (from frontend/)
pnpm test                           # Run all vitest tests once
pnpm test:watch                     # Run vitest in watch mode
```

### Test Infrastructure

**Rust** (47 tests):
- **Shared test helpers**: `database/test_helpers.rs` — `create_test_pool()` (in-memory SQLite + migrations), `seed_meeting()`, `seed_transcript()`
- **Speaker repository**: `database/repositories/speaker.rs` — 27 tests (pure helper functions + async DB operations)
- **Transcript repository**: `database/repositories/transcript.rs` — 5 tests (batch speaker update)
- **Speaker identifier parsing**: `chat/speaker_identifier.rs` — 15 tests (JSON parsing, fallback handling)

**TypeScript** (vitest, 26 tests):
- **Speaker colors**: `src/lib/speaker-colors.test.ts` — palette structure, color selection, hash stability, dark mode fields, `getThemedClasses()` output
- Config: `frontend/vitest.config.ts`, path alias `@` → `src/`

**Pattern for adding new Rust DB tests**:
```rust
#[cfg(test)]
mod tests {
    use crate::database::test_helpers::{create_test_pool, seed_meeting, seed_transcript};

    #[tokio::test]
    async fn my_test() {
        let pool = create_test_pool().await;  // Fresh in-memory DB each test
        seed_meeting(&pool, "m1", "Test Meeting").await;
        // ... test logic
    }
}
```

## Debugging

### Frontend Debugging

**Enable Rust Logging**:
```bash
# macOS
RUST_LOG=debug ./clean_run.sh

# Windows (PowerShell)
$env:RUST_LOG="debug"; ./clean_run_windows.bat
```

**Developer Tools**:
- Open DevTools: `Cmd+Shift+I` (macOS) or `Ctrl+Shift+I` (Windows)
- Console Toggle: Built into app UI (console icon)
- View Rust logs: Check terminal output

### Backend Debugging

**View API Logs**:
```bash
# Backend logs show in terminal with detailed formatting:
# 2025-01-03 12:34:56 - INFO - [main.py:123 - endpoint_name()] - Message
```

**Test API Directly**:
- Swagger UI: http://localhost:5167/docs
- ReDoc: http://localhost:5167/redoc

### Audio Pipeline Debugging

**Key Metrics** (emitted by pipeline):
- Buffer sizes (mic/system)
- Mixing window count
- VAD detection rate
- Dropped chunk warnings

**Monitor via Developer Console**: The app includes real-time metrics display when recording.

## Platform-Specific Notes

### macOS
- **Audio Capture**: Uses ScreenCaptureKit for system audio (macOS 13+)
- **GPU**: Metal + CoreML automatically enabled
- **Permissions**: Requires microphone + screen recording permissions
- **System Audio**: Requires virtual audio device (BlackHole) for system capture

### Windows
- **Audio Capture**: Uses WASAPI (Windows Audio Session API)
- **GPU**: CUDA (NVIDIA) or Vulkan (AMD/Intel) via Cargo features
- **Build Tools**: Requires Visual Studio Build Tools with C++ workload
- **System Audio**: Uses WASAPI loopback for system capture

### Linux
- **Audio Capture**: ALSA/PulseAudio
- **GPU**: CUDA (NVIDIA) or Vulkan via Cargo features
- **Dependencies**: Requires cmake, llvm, libomp

## Performance Optimization Guidelines

### Audio Processing
- Use `perf_debug!()` / `perf_trace!()` for hot-path logging (zero cost in release)
- Batch audio metrics using `AudioMetricsBatcher` (pipeline.rs)
- Pre-allocate buffers with `AudioBufferPool` (buffer_pool.rs)
- VAD filtering reduces Whisper load by ~70% (only processes speech)

### Whisper Transcription
- **Model Selection**: Balance accuracy vs speed
  - Development: `base` or `small` (fast iteration)
  - Production: `medium` or `large-v3` (best quality)
- **GPU Acceleration**: 5-10x faster than CPU
- **Parallel Processing**: Available in `whisper_engine/parallel_processor.rs` for batch workloads

### Frontend Performance
- React state updates batched via Sidebar context
- Transcript rendering virtualized for large meetings
- Audio level monitoring throttled to 60fps

## Important Constraints and Gotchas

1. **Audio Chunk Size**: Pipeline expects consistent 48kHz sample rate. Resampling happens at capture time.

2. **Platform Audio Quirks**:
   - macOS: ScreenCaptureKit requires macOS 13+, needs screen recording permission
   - Windows: WASAPI exclusive mode can conflict with other apps
   - System audio requires virtual device (BlackHole on macOS, WASAPI loopback on Windows)

3. **Whisper Model Loading**: Models are loaded once and cached. Changing models requires app restart or manual unload/reload.

4. **Backend Dependency**: Frontend can run standalone (local Whisper), but meeting persistence and LLM features require backend running.

5. **CORS Configuration**: Backend allows all origins (`"*"`) for development. Restrict for production deployment.

6. **File Paths**: Use Tauri's path APIs (`downloadDir`, etc.) for cross-platform compatibility. Never hardcode paths.

7. **Audio Permissions**: Request permissions early. macOS requires both microphone AND screen recording for system audio.

8. **Database Model ↔ Migration Sync**: When adding columns via SQLx migrations, always update the corresponding Rust `FromRow` struct in `database/models.rs` to include the new fields. Queries using `SELECT *` or `query_as` will fail at runtime if the struct doesn't match the schema. Prefer explicit column lists in `SELECT` queries over `SELECT *` for resilience.

9. **Theme-Aware Colors**: All components use semantic CSS variable-based colors, not hardcoded Tailwind grays. Follow these mappings:
   - `bg-white` → `bg-surface` | `bg-gray-50` → `bg-surface-secondary` | `bg-gray-100` → `bg-surface-tertiary` | `bg-gray-200` → `bg-surface-hover`
   - `text-gray-900/800` → `text-foreground` | `text-gray-700` → `text-text-primary` | `text-gray-600` → `text-text-secondary` | `text-gray-500` → `text-muted-foreground` | `text-gray-400` → `text-text-placeholder`
   - `border-gray-200` → `border-border` | `border-gray-100` → `border-border-subtle` | `border-gray-300` → `border-input`
   - For accent colors (blue, red, green), keep the light value and add a `dark:` variant: e.g., `bg-blue-50 dark:bg-blue-950`, `text-blue-700 dark:text-blue-300`
   - Brand/status colors (`bg-blue-600 text-white`, `bg-red-500`, `bg-green-500`) work in both themes — keep as-is

## Repository-Specific Conventions

- **Logging Format**: Backend uses detailed formatting with filename:line:function
- **Error Handling**: Rust uses `anyhow::Result`, frontend uses try-catch with user-friendly messages
- **Naming**: Audio devices use "microphone" and "system" consistently (not "input"/"output")
- **Git Branches**:
  - `main`: Stable releases
  - `fix/*`: Bug fixes
  - `enhance/*`: Feature enhancements
  - Current: `enhance/meeting-context-grading-chat` (meeting context, communication grading, and chat features)

## Key Files Reference

**Core Coordination**:
- [frontend/src-tauri/src/lib.rs](frontend/src-tauri/src/lib.rs) - Main Tauri entry point, command registration
- [frontend/src-tauri/src/audio/mod.rs](frontend/src-tauri/src/audio/mod.rs) - Audio module exports
- [backend/app/main.py](backend/app/main.py) - FastAPI application, API endpoints

**Build Scripts**:
- [frontend/rebuild_install.sh](frontend/rebuild_install.sh) - Quick incremental rebuild + install to `/Applications` (use after migration changes)

**Audio System**:
- [frontend/src-tauri/src/audio/recording_manager.rs](frontend/src-tauri/src/audio/recording_manager.rs) - Recording orchestration
- [frontend/src-tauri/src/audio/pipeline.rs](frontend/src-tauri/src/audio/pipeline.rs) - Audio mixing and VAD
- [frontend/src-tauri/src/audio/recording_saver.rs](frontend/src-tauri/src/audio/recording_saver.rs) - Audio file writing

**UI Components**:
- [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Main recording interface
- [frontend/src/components/Sidebar/SidebarProvider.tsx](frontend/src/components/Sidebar/SidebarProvider.tsx) - Global state management

**Whisper Integration**:
- [frontend/src-tauri/src/whisper_engine/whisper_engine.rs](frontend/src-tauri/src/whisper_engine/whisper_engine.rs) - Whisper model management and transcription

**Communication Grading** (new):
- [frontend/src-tauri/src/grading/](frontend/src-tauri/src/grading/) - Grading backend module
  - `commands.rs` - `api_generate_grade`, `api_get_grade` Tauri commands
  - `service.rs` - Background grade generation (follows summary service pattern)
  - `processor.rs` - Context-aware grading prompt construction
- [frontend/src/components/MeetingDetails/GradePanel.tsx](frontend/src/components/MeetingDetails/GradePanel.tsx) - Grade display UI
- [frontend/src/hooks/meeting-details/useGrading.ts](frontend/src/hooks/meeting-details/useGrading.ts) - Grade generation hook

**Meeting Chat** (new):
- [frontend/src-tauri/src/chat/](frontend/src-tauri/src/chat/) - Chat backend module
  - `commands.rs` - `api_create_chat_session`, `api_send_chat_message`, `api_get_chat_history`, `api_list_chat_sessions`
  - `service.rs` - Message handling, LLM calls with conversation history
  - `context_builder.rs` - Builds LLM context from single meeting or cross-meeting search
- [frontend/src/components/MeetingDetails/ChatPanel.tsx](frontend/src/components/MeetingDetails/ChatPanel.tsx) - Chat UI
- [frontend/src/hooks/meeting-details/useChat.ts](frontend/src/hooks/meeting-details/useChat.ts) - Chat session hook

**Meeting Context** (new):
- [frontend/src/components/MeetingContextSelector.tsx](frontend/src/components/MeetingContextSelector.tsx) - Meeting type selector
- Meeting context fields (`context_type`, `context_notes`) stored on `meetings` table
- Context commands: `api_save_meeting_context`, `api_get_meeting_context` in `api/api.rs`

**Speaker Management** (new):
- [frontend/src-tauri/src/database/repositories/speaker.rs](frontend/src-tauri/src/database/repositories/speaker.rs) - `SpeakerRepository` CRUD, reassign, ensure_default_speakers (27 unit tests)
- [frontend/src-tauri/src/chat/speaker_identifier.rs](frontend/src-tauri/src/chat/speaker_identifier.rs) - LLM-based speaker identification and assignment (15 parsing tests)
- [frontend/src/lib/speaker-colors.ts](frontend/src/lib/speaker-colors.ts) - 12-palette color system, hash-based selection (22 vitest tests)
- [frontend/src/components/MeetingDetails/SpeakerManagementPanel.tsx](frontend/src/components/MeetingDetails/SpeakerManagementPanel.tsx) - Rename, recolor, merge, delete, add speakers
- [frontend/src/hooks/meeting-details/useSpeakers.ts](frontend/src/hooks/meeting-details/useSpeakers.ts) - Central speaker state hook
- [frontend/src/components/VirtualizedTranscriptView.tsx](frontend/src/components/VirtualizedTranscriptView.tsx) - `SpeakerDropdown` + multi-select with Shift/Cmd+click
- [frontend/src/components/MeetingDetails/SpeakerBadge.tsx](frontend/src/components/MeetingDetails/SpeakerBadge.tsx) - Speaker badge with palette-based color coding

**Theme System**:
- [frontend/tailwind.config.ts](frontend/tailwind.config.ts) - `darkMode: 'class'`, semantic color mappings (`surface`, `surface-secondary`, `text-primary`, etc.)
- [frontend/src/app/globals.css](frontend/src/app/globals.css) - CSS custom properties for `:root` (light) and `.dark` themes
- [frontend/src/app/layout.tsx](frontend/src/app/layout.tsx) - `ThemeProvider` from `next-themes` wrapping the app
- [frontend/src/components/ThemeToggle.tsx](frontend/src/components/ThemeToggle.tsx) - Theme toggle (light/dark/system), compact and full modes
- [frontend/src/components/PreferenceSettings.tsx](frontend/src/components/PreferenceSettings.tsx) - "Appearance" section with theme toggle
- [frontend/src/lib/speaker-colors.ts](frontend/src/lib/speaker-colors.ts) - Dark mode palette fields (`darkBg`, `darkText`, `darkBorder`) + `getThemedClasses()` helper

**Test Infrastructure**:
- [frontend/src-tauri/src/database/test_helpers.rs](frontend/src-tauri/src/database/test_helpers.rs) - Shared test pool + seed helpers for Rust DB tests
- [frontend/vitest.config.ts](frontend/vitest.config.ts) - Vitest configuration for TypeScript tests
- [frontend/src/lib/speaker-colors.test.ts](frontend/src/lib/speaker-colors.test.ts) - Speaker color utility tests

### Known Issues

1. **Grading evaluates the whole conversation** — Currently grades all speakers as one. Needs per-speaker analysis once speaker diarization labels are available in transcripts.
2. **Chat with BuiltInAI fails** — "Failed to add token to batch" error when using local BuiltInAI models. The full transcript context can exceed the model's context window. Workaround: use a cloud provider (OpenAI, Claude, Groq) or Ollama with a model that has a larger context window. Fix needed: truncate/summarize context to fit model limits in `chat/context_builder.rs`.
3. ~~**Summary and Chat panels not scrollable**~~ — Fixed: Added `min-h-0` to tab content container and panel roots to enable flex shrinking and scrolling.
4. **App performance** — Partially addressed: panels wrapped in `React.memo`, grade polling uses exponential backoff (2s→10s cap), virtualization threshold lowered to 5. Further profiling with React DevTools still recommended for hot paths.
5. ~~**Custom speaker names show gray color**~~ — Fixed: `SpeakerBadge` now uses hash-based deterministic color selection from 12 Tailwind palettes for custom speaker names.
6. **Speaker diarization is source-based, not voice-based** — The current system tags segments as `mic` (DeviceType::Microphone) or `system` (DeviceType::System) based on which audio input device captured them. This means "You" = microphone audio and "Other" = system/speaker audio. It does NOT perform true speaker diarization (voice fingerprinting to distinguish Person A from Person B within the same audio stream). The `speaker_identifier.rs` module exists as an LLM-based post-hoc approach that analyzes transcript text patterns to suggest speaker labels for system audio segments, but it cannot distinguish individual voices in real-time. True diarization would require integrating a model like `pyannote.audio` or `NeMo MSDD` into the audio pipeline to cluster voice embeddings per speaker.
7. **Dev startup race condition** — `clean_run.sh` runs `pnpm build` (static export) then `pnpm run tauri dev`, which runs `beforeDevCommand: "pnpm dev"` to start the Next.js dev server. Tauri opens the webview immediately, often before Next.js finishes compiling pages, causing a 404. Workaround: wait a few seconds then reload the page, or use `pnpm run tauri dev` directly (without `clean_run.sh`) when iterating on frontend changes. Also, always kill stale processes on port 3118 before restarting (`lsof -ti:3118 | xargs kill -9`).
8. **Do not use the in-app updater during development** — The Tauri updater replaces the dev binary with the release build, which will crash or behave unexpectedly. To get upstream fixes on a feature branch, use `git merge main` instead.
9. **Installed app crashes after running dev builds with new migrations** — If you run dev builds that apply new SQLx migrations, the installed app at `/Applications/Meetily.app/` (which has older migrations compiled in) will crash on launch with `panic_cannot_unwind` because SQLx rejects unknown migrations. Fix: run `./rebuild_install.sh` from `frontend/` to rebuild and reinstall the app with current migrations. This is needed any time new migration files are added.
10. **SQLx proc-macro cache prevents new migrations from embedding** — The `sqlx::migrate!()` macro is expanded by `sqlx-macros` at compile time. Its output is cached in `target/release/.fingerprint/sqlx-macros-*`. Running `cargo clean -p meetily` alone does NOT invalidate this cache, so new migration files won't be picked up. Fix: also delete the sqlx macro fingerprints: `rm -rf target/release/.fingerprint/sqlx-macros-*` before rebuilding. The `rebuild_install.sh` script now removes the old app bundle with `rm -rf` before copying to avoid stale binary issues.
