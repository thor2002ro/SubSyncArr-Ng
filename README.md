# 🧬 SubSyncArr-Ng

**SubSyncArr-Ng** (Next-Generation) is an automated subtitle synchronization suite designed to run seamlessly in Docker. It continuously monitors your movie and TV show libraries, identifies out-of-sync subtitles, and synchronizes them using **ffsubsync**, **autosubsync**, **alass**, and the optional speech recognition engine **SubSync**.

SubSyncArr-Ng is non-destructive: it preserves your original subtitles untouched and creates distinct synchronized copies for each engine, providing full redundancy and flexibility in players like Plex, Jellyfin, Emby, and Kodi.

---

## 🌟 What's New in SubSyncArr-Ng

- 🌙 **Modern Dark Mode**: Sleek dark interface with responsive theme toggle (☀️ / 🌙), `localStorage` persistence, and automatic operating system theme detection (`prefers-color-scheme`).
- ⚡ **Live Real-Time File Logs**: Streaming terminal console embedded directly inside the "Currently Processing" card with an active status pulse and auto-scroll, showing audio extraction, speech feature detection, and alignment progress in real time.
- 📄 **Detailed File Log Modal**: Inspect complete stdout, stderr, execution duration, and timeline for any file (both currently running and completed/historical) with one click.
- 🗑️ **Orphaned Subtitle Cleanup (`DELETE_ORPHANED_SRT=true`)**: Automatically purges orphaned subtitle files and their previously synced variants if no corresponding video file exists on disk.
- 🎯 **Smart TV Episode Number Matching**: Intelligently resolves episode numbering differences between subtitles and videos (e.g., matching `00x20` to `S00E20`), preventing valid TV subtitles from being misidentified as orphans.
- 🛠️ **MKV Attachment Streams Fix for `alass`**: Includes an integrated `ffprobe` wrapper that handles MKV files containing embedded attachment streams (such as subtitle fonts or cover art) without crashing Rust's JSON deserializer.
- ⚡ **Continuous Worker Pool**: Dynamic queue-based concurrency replaces rigid batching—as soon as any worker completes a file, it immediately pulls the next file from the queue, maximizing CPU utilization.
- 🧬 **Dual-Fingerprint Anti-Loop (Video + SRT)**: Prevents endless re-processing loops when external tools (Bazarr, Plex, promotion scripts) rename or move synced subtitles. Computes a fast header/tail SHA-256 for the video and full SHA-256 for the subtitle. If Bazarr downloads an updated/better subtitle, SubSyncArr-Ng automatically detects the change and resyncs!
- ↻ **Interactive Circuit Breaker Reset**: Direct `[↻ Reset]` button right inside the Web UI file cards to unblock files blacklisted by the 3-failure circuit breaker with a single click.
- 📁 **Extended Video Formats**: Native support for `.mkv`, `.mp4`, `.avi`, `.mov`, `.ts`, `.m4v`, `.webm`, `.wmv`, and `.flv`.

---

## ⚙️ Synchronization Engines

No single subtitle synchronization algorithm works perfectly for every scenario (movies, TV shows, PAL/NTSC frame rate changes, commercial breaks, noisy audio, or sparse forced dialogue). SubSyncArr-Ng enables **three complementary engines by default**, with SubSync available as an additional option:

```
                  ┌─────────────────┐
                  │ Input Subtitle  │ (.srt)
                  └────────┬────────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  ffsubsync   │    │ autosubsync  │    │    alass     │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       ▼                   ▼                   ▼
.ffsubsync.srt      .autosubsync.srt       .alass.srt
```

### 1. `ffsubsync` (Fast Forward Subtitle Sync)
- **Technology**: Python + WebRTC Voice Activity Detection (VAD) + Fast Fourier Transform (FFT).
- **How it works**: Uses ffmpeg to extract the audio stream and translates both the audio voice activity and the subtitle timestamps into mathematical signals. It applies FFT-accelerated cross-correlation to find the optimal global linear offset and speed skew.
- **Best for**: Standard movie releases, linear delays (e.g. subtitles starting 5 seconds too late), and frame-rate conversions (e.g. 23.976 fps to 25.000 fps).
- **Speed**: Extremely fast (typically 5–15 seconds).
- **Output**: `<filename>.<lang>.ffsubsync.srt`

### 2. `autosubsync` (Acoustic Feature & Speech Detection)
- **Technology**: Python + NumPy/SciPy + Pretrained Neural Acoustic Model.
- **How it works**: Computes Mel-Frequency Cepstral Coefficients (MFCC) and energy spectrograms from the audio track. A trained machine learning model identifies speech frames and computes correlation curves against dialogue blocks across a spectrum of candidate skew factors.
- **Best for**: Clean movie dialogue and studio audio tracks where speech cadence can be reliably matched.
- **Special Handling in Ng**: Because autosubsync requires continuous dialogue, SubSyncArr-Ng automatically skips `.forced.srt` files for autosubsync (delegating them to `ffsubsync` and `alass`) and limits worker threads to 1 (`--parallelism 1`) to ensure 4K Remuxes do not trigger Out-Of-Memory (OOM) errors.
- **Output**: `<filename>.<lang>.autosubsync.srt`

### 3. `alass` (Automatic Language-Agnostic Subtitle Synchronization)
- **Technology**: Rust + Dynamic Programming Alignment.
- **How it works**: Analyzes pauses and voice segments using advanced dynamic programming. Unlike pure linear-shift tools, `alass` can split subtitles into independent segments and align each chunk separately.
- **Best for**: TV shows with commercial breaks, Director's Cut vs Theatrical releases, or video files where scenes have been added or removed in the middle of the timeline.
- **Speed**: Blazing fast native Rust execution (typically 3–10 seconds).
- **Output**: `<filename>.<lang>.alass.srt`

### 4. `subsync` (Subtitle Speech Synchronizer, optional)

- **Source**: [neck0l/subsync](https://github.com/neck0l/subsync), the modernized SubSync fork, pinned in the Docker build.
- **How it works**: Recognizes words in the video's audio and correlates them with subtitle words to correct delay and pace. Different subtitle/audio languages require an available dictionary from upstream.
- **Output**: `<filename>.<lang>.subsync.srt`, always UTF-8. Legacy-encoded input is normalized temporarily; the original source is preserved unless replacement is explicitly enabled.
- **Enable**: Set `INCLUDE_ENGINES=subsync` to use it alone, or append `subsync` to your existing list. The existing default list remains unchanged.
- **Languages**: Subtitle language comes from the filename (`movie.en.srt`, `movie.ron.forced.srt`) or `SUBSYNC_SUB_LANG`. Reference language comes from the selected audio stream's metadata or `SUBSYNC_REF_LANG`. Set the latter when audio metadata is missing or wrong. These settings accept upstream's two- or three-letter language codes, for example `en` / `eng`.
- **Language compatibility**: Common ISO aliases are normalized to upstream's model keys (`ron` → `rum`, `deu` → `ger`, `fra` → `fre`). Explicit unsupported language overrides fail clearly. The fork's language table and available assets limit support; selecting a speech backend does not add missing language entries.
- **Audio selection**: Uses the first audio stream. `SUBSYNC_REF_STREAM` selects an explicit **1-based absolute container stream number**, counting video and other streams too. Without `SUBSYNC_REF_LANG`, ffprobe reads that stream's language and normalizes it to the upstream model key. Missing or unsupported metadata fails with instructions to set `SUBSYNC_REF_LANG`. This override sets the language of the selected stream; it does not choose a different audio track.
- **Models and dictionaries**: Downloaded automatically on first use. Internet access is needed for uncached assets; missing languages/models/dictionaries fail with engine logs. Docker persists this cache at `/app/data/subsync`, covered by the existing `/app/data` volume. Allow time for downloads within `SYNC_ENGINE_TIMEOUT_MS`.
- **Concurrency and timeout**: `SUBSYNC_JOBS=1` limits internal decoder workers. SubSync CLI calls sharing a cache run one at a time under an OS file lock, protecting models during download and use; other engines can still run concurrently. The engine timeout includes metadata probing and lock waiting. A timeout releases the lock automatically.
- **Speech backend**: The Docker image bundles PocketSphinx (`sphinx`). `SUBSYNC_SPEECH_ENGINE=vosk` or `whisper` requires a separately built SubSync CLI with the corresponding native backend. Setting the variable alone does not install it.

Example for Romanian subtitles with English audio:

```yaml
environment:
  - INCLUDE_ENGINES=subsync
  - SUBSYNC_SUB_LANG=ron
  - SUBSYNC_REF_LANG=eng
```

For a non-Docker installation, build the pinned fork from source with its FFmpeg
and PocketSphinx development dependencies (`libavdevice-dev`, `libavformat-dev`,
`libavfilter-dev`, `libavcodec-dev`, `libswresample-dev`, `libswscale-dev`,
`libavutil-dev`, `libpocketsphinx-dev`, `libsphinxbase-dev`, `python3-dev`,
`pkg-config`, and a C++ compiler on Debian Bookworm). Also install `ffmpeg` and
`util-linux` for the ffprobe and flock runtime commands. Install SubSync in a Python venv
and put that venv's `bin` directory on the application's `PATH`. The Dockerfile
contains the pinned build recipe. Check `subsync --cli --help` before enabling it;
installing an unrelated package named `subsync` will not provide this engine.

---

## 🔄 What Happens During a Scan? (The Workflow)

1. **Discovery & Filtering**: SubSyncArr-Ng scans all paths configured in `SCAN_PATHS` for `.srt` files. Files that are already synchronized (or whose synced outputs already exist) are skipped to save system resources.
2. **Video Association**: The engine pairs each `.srt` file with its video file in the same directory:
   - First by exact name match.
   - Then by progressive tag stripping (removing release group, audio, and resolution tags).
   - Finally by TV episode pattern matching (`00x20` matches `S00E20`).
3. **Orphan Cleanup**: If a subtitle has no corresponding video file in its directory and `DELETE_ORPHANED_SRT` is enabled, the orphan subtitle and any obsolete synced variants are deleted automatically.
4. **Multi-Engine Execution**: Each enabled engine runs in sequence:
   - Real-time stdout and stderr output is streamed live to the Web UI via WebSockets.
   - Each engine produces its own separate `.srt` output.
   - If one engine fails or has insufficient fit quality on noisy background audio, the others continue and succeed.
5. **Database & History**: Results, timestamps, and full execution logs are recorded in the local SQLite database.

---

## 🚀 Quick Start

### Git source builds

All four engines are built inside dedicated Docker builder stages. The runtime
image contains installed Python environments and the compiled Rust executable;
the repository's old `bin/alass` executable is excluded from the build context.

The defaults pin the latest upstream default-branch commits checked on
**2026-10-27**:

| Engine | Upstream | Commit | Docker target |
| :--- | :--- | :--- | :--- |
| ffsubsync | [smacke/ffsubsync](https://github.com/smacke/ffsubsync) | `de310ac6944b8260431a48ee741e7063cec49b0f` | `ffsubsync-builder` |
| autosubsync | [oseiskar/autosubsync](https://github.com/oseiskar/autosubsync) | `b392da2713aafe6de83e08e2571198988612febc` | `autosubsync-builder` |
| alass | [kaegi/alass](https://github.com/kaegi/alass) | `874f02d9577182752a0f969b6d6b98fd65bdf1fc` | `alass-builder` |
| SubSync | [neck0l/subsync](https://github.com/neck0l/subsync) | `1ff7bc91b87fe6644250323b8add790f8a9df2f2` | `subsync-builder` |

To build an individual engine container for inspection, use its target:

```bash
docker build --target alass-builder -t subsyncarr-alass-builder .
```

Full image builds use all four stages automatically. Installed revisions are
recorded in `/app/engine-sources.json` and image labels named
`io.subsyncarr.<engine>.revision`. Builds use the pinned snapshot; they do not
silently change to newer commits when a Docker cache is reused. Refresh the
`FFSUBSYNC_COMMIT`, `AUTOSUBSYNC_COMMIT`, `ALASS_COMMIT`, or `SUBSYNC_COMMIT`
build argument with a full upstream commit SHA to update an engine.

Autosubsync omits its pretrained model from Git. Its code is built from the Git
checkout with the upstream release's checksum-verified JSON model bundled as
data; model provenance and license are in `assets/autosubsync/`. Python/Rust
dependencies come from their package registries, and FFmpeg/PocketSphinx runtime
libraries come from Debian Bookworm.

### Using Docker Compose

Create or update your `docker-compose.yaml`:

```yaml
name: subsyncarr

services:
  subsyncarr:
    build:
      context: .
      dockerfile: Dockerfile
    image: subsyncarr-ng:latest
    container_name: subsyncarr
    ports:
      - '3030:3000' # Web UI accessible at http://<host>:3030
    volumes:
      # Mount your media directories
      - /path/to/movies:/movies
      - /path/to/tv:/tv
      - /path/to/appdata/subsyncarr:/app/data # SQLite database & logs
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2048M # Recommended for 4K / high-bitrate media
        reservations:
          memory: 256M
    environment:
      - PUID=1000
      - PGID=100
      - TZ=Europe/Rome
      - CRON_SCHEDULE=0 0 * * * # Automatic scan daily at midnight
      - SCAN_PATHS=/movies,/tv
      - EXCLUDE_PATHS=/movies/temp,/tv/downloads
      - MAX_CONCURRENT_SYNC_TASKS=1
      - INCLUDE_ENGINES=ffsubsync,autosubsync,alass
      - REPLACE_ORIGINAL_SUBTITLE=false
      - AUTOSUBSYNC_PARALLELISM=1
      - AUTOSUBSYNC_SKIP_FORCED=true
      - DELETE_ORPHANED_SRT=true
```

Run the container:

```bash
docker compose up -d
```

Open your browser at **`http://localhost:3030`** (or your server's IP address on port `3030`).

---

## 📋 Configuration Options

### Core Settings

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SCAN_PATHS` | `/scan_dir` | Comma-separated paths to scan for subtitles (e.g. `/movies,/tv`) |
| `EXCLUDE_PATHS` | _(none)_ | Comma-separated directory paths to exclude from scanning |
| `SYNC_LANGUAGES` | _(none)_ | Comma-separated language codes to sync (e.g., `it,en`). If unset, all subtitles are synced |
| `CRON_SCHEDULE` | `0 0 * * *` | Cron schedule for automatic runs, or `disabled` to turn off |
| `MAX_CONCURRENT_SYNC_TASKS` | `1` | Number of files processed in parallel (1 is recommended to conserve CPU/RAM) |
| `INCLUDE_ENGINES` | `ffsubsync,autosubsync,alass` | Comma-separated list of engines to run |
| `REPLACE_ORIGINAL_SUBTITLE` | `false` | Replace the source subtitle after a successful run. Applies only when exactly one engine is enabled |
| `DELETE_ORPHANED_SRT` | `true` | Automatically delete subtitle files that have no matching video in their folder |
| `AUTOSUBSYNC_PARALLELISM` | `1` | Worker threads for autosubsync (set to 1 to prevent OOM on 4K files) |
| `AUTOSUBSYNC_SKIP_FORCED` | `true` | Skip autosubsync on `.forced.srt` files (handled by ffsubsync and alass) |
| `FFSUBSYNC_SUFFIX` | `ffsubsync` | Custom suffix for ffsubsync outputs (e.g. `movie.en.ffsubsync.srt`) |
| `AUTOSUBSYNC_SUFFIX` | `autosubsync` | Custom suffix for autosubsync outputs |
| `ALASS_SUFFIX` | `alass` | Custom suffix for alass outputs |
| `ALASS_EXTRA_ARGS` | _(none)_ | Extra CLI flags passed directly to `alass` (e.g. `--disable-fps-guessing`, `--split-penalty 15`, `--no-split`) |
| `SUBSYNC_SUFFIX` | `subsync` | Custom suffix for SubSync outputs |
| `SUBSYNC_SPEECH_ENGINE` | `sphinx` | Speech backend: `sphinx`, `vosk`, or `whisper`; Docker bundles `sphinx` |
| `SUBSYNC_SUB_LANG` | _(automatic)_ | Override subtitle language; otherwise use filename or upstream detection |
| `SUBSYNC_REF_LANG` | _(audio metadata)_ | Override reference audio language, e.g. `eng` |
| `SUBSYNC_REF_STREAM` | _(first audio)_ | Select a 1-based absolute container stream number |
| `SUBSYNC_FFPROBE_PATH` | `/usr/bin/ffprobe` | Direct ffprobe executable used for metadata; bypasses the bundled wrapper so timeouts terminate the real probe |
| `SUBSYNC_JOBS` | `1` | Positive integer limiting internal SubSync decoder workers |
| `SUBSYNC_LOCK_PATH` | `~/.config/subsync/.subsyncarr.lock` | Linux cache lock file; if overriding, all app instances sharing a model cache must use the same file |
| `SYNC_ENGINE_TIMEOUT_MS` | `1800000` | Engine timeout in milliseconds (default 30 minutes) |
| `WEB_PORT` | `3000` | Internal port for the Web UI (mapped to host port via docker-compose) |
| `WEB_HOST` | `0.0.0.0` | Host interface for Web UI binding |
| `PUID` | `1000` | User ID for file permissions |
| `PGID` | `100` | Group ID for file permissions |
| `TZ` | `Etc/UTC` | Timezone for logs and cron scheduling (e.g. `Europe/Rome`) |

Standard engine output suffixes are excluded from discovery even when that
engine is disabled. Custom suffixes are recognized only for enabled engines, so
an inactive custom suffix cannot hide original language-tagged subtitles. Before
disabling an engine with a custom suffix, move or exclude its generated files if
they should remain outside later scans.

### Database & Retention Settings

| Variable | Default | Description |
| :--- | :--- | :--- |
| `DB_PATH` | `/app/data/subsyncarr-plus.db` | SQLite database file location |
| `LOG_BUFFER_SIZE` | `1000` | Maximum log lines kept in memory |
| `RETENTION_KEEP_RUNS_DAYS` | `30` | Keep completed runs in database for N days |
| `RETENTION_TRIM_LOGS_DAYS` | `7` | Trim verbose logs after N days (keeps summary only) |
| `RETENTION_CLEANUP_INTERVAL_HOURS` | `24` | Frequency of database cleanup job |

---

## 🖥️ Web UI Guide

The Web UI provides complete real-time monitoring and control:

1. **Header & Status Indicators**:
   - ☀️ / 🌙 **Theme Switcher**: Instant toggle between sleek Dark Mode and Light Mode.
   - **Watching Folders**: Displays currently monitored directories.
   - **Next Scheduled Scan**: Shows the next automated cron run time.
   - **Controls**: *Start Full Run*, *Scan Specific Path* (with interactive folder picker), and *Stop Processing*.

2. **Currently Processing Card**:
   - Live progress bar with completion percentages.
   - Current engine indicator (`⚙️ Working on ffsubsync`).
   - **Embedded Live Console**: Monospace terminal box streaming the real-time output of the running engine, complete with pulsing green indicator and auto-scrolling.
   - **`[📄 View Log]` Button**: Opens a full-screen detailed log modal for the active file.
   - **`[Skip]` Button**: Cancels processing for that specific file.
   - **`[📜 Live Run Log]` Button**: Opens the global run log for the entire session.

3. **Completed & Skipped Files**:
   - Badges showing engine execution times (e.g., `✓ ffsubsync 5.0s`, `✓ alass 3.3s`).
   - **`[📄 Log]` Button**: Click on any completed file to view its complete timeline, engine duration, stdout, stderr, and copy log output to clipboard.
   - **`Clear Files` Button**: Cleans completed files from the UI display without altering disk data.

4. **Run History**:
   - Comprehensive historical table of past runs with file counts, engine pass/fail breakdown (**F**, **Au**, **Al**, **S**), duration, and full run log viewer.

---

## 📁 Recommended Media Organization

```txt
/movies
├── The Old Man and the Gun (2018) {imdb-tt2837574}/
│   ├── The Old Man and the Gun (2018).mkv
│   ├── The Old Man and the Gun (2018).it.forced.srt          # Original subtitle
│   ├── The Old Man and the Gun (2018).it.forced.ffsubsync.srt # Synced copy
│   └── The Old Man and the Gun (2018).it.forced.alass.srt     # Synced copy

/tv
└── American Ninja Warrior (2009)/
    ├── American Ninja Warrior (2009) - S00E20.mkv
    ├── American Ninja Warrior (2009) - 00x20 - Celebrity.en.srt          # Original
    ├── American Ninja Warrior (2009) - 00x20 - Celebrity.en.ffsubsync.srt # Synced
    └── American Ninja Warrior (2009) - 00x20 - Celebrity.en.alass.srt     # Synced
```

---

## 📄 License

Open-source under the original project license. Maintained at [https://github.com/Jorman/SubSyncArr-Ng](https://github.com/Jorman/SubSyncArr-Ng).
