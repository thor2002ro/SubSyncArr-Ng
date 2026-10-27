# 🧬 SubSyncArr-Ng

**SubSyncArr-Ng** (Next-Generation) is an automated subtitle synchronization suite designed to run in Docker. It scans movie and TV show libraries on demand or on a cron schedule and synchronizes subtitles using **ffsubsync**, **autosubsync**, **alass**, and the speech recognition engine **SubSync**. All four engines are enabled by default.

By default, SubSyncArr-Ng preserves original subtitles and creates a separate synchronized copy for each engine, for use in Plex, Jellyfin, Emby, and Kodi. Original replacement is opt-in and requires exactly one selected engine.

---

## 🌟 What's New in SubSyncArr-Ng

- **Detailed Dashboard**: Compact run metrics, active-file and engine status, bounded live output, watched folders, scheduling, engine totals, searchable file results, and run history. Light/dark themes follow your system preference and remember your selection.
- **Four Engines Enabled by Default**: `ffsubsync`, `autosubsync`, `alass`, and `subsync` share the same default selection across discovery, processing, task accounting, and the dashboard. Existing deployments with an explicit three-engine `INCLUDE_ENGINES` value must add `subsync` to that value to use all four.
- **Engines Built from Pinned Git Sources**: Dedicated Docker stages build all four engines. Source revisions are recorded in image labels and `/app/engine-sources.json`; build arguments select replacement revisions.
- **Safe Engine Execution**: Media paths are passed as literal arguments, legacy subtitle encodings use temporary UTF-8 input, and a regular, nonempty output is required for success. Failed or partial outputs are cleaned up. ffsubsync's structured API result is checked through a Python bridge.
- ⚡ **Live File Logs**: The Active run panel combines recent engine output across files. Pause view stops scrolling updates while collection continues; resume shows the buffered output.
- 📄 **Detailed File Log Modal**: Inspect a file's buffered log, reported engine durations, and captured stdout/stderr. Dialogs are bound to their run so output from a later run cannot be mixed into an earlier one.
- 🗑️ **Orphaned Subtitle Cleanup (`DELETE_ORPHANED_SRT=true`)**: Automatically purges orphaned subtitle files and their previously synced variants if no corresponding video file exists on disk.
- 🎯 **Smart TV Episode Number Matching**: Intelligently resolves episode numbering differences between subtitles and videos (e.g., matching `00x20` to `S00E20`), preventing valid TV subtitles from being misidentified as orphans.
- 🛠️ **MKV Attachment Streams Fix for `alass`**: Includes an integrated `ffprobe` wrapper that handles MKV files containing embedded attachment streams (such as subtitle fonts or cover art) without crashing Rust's JSON deserializer.
- ⚡ **Continuous Worker Pool**: Dynamic queue-based concurrency replaces rigid batching—as soon as any worker completes a file, it immediately pulls the next file from the queue, maximizing CPU utilization.
- 🧬 **Dual-Fingerprint Anti-Loop (Video + SRT)**: Prevents endless re-processing loops when external tools (Bazarr, Plex, promotion scripts) rename or move synced subtitles. Computes a fast header/tail SHA-256 for the video and full SHA-256 for the subtitle. If Bazarr downloads an updated/better subtitle, SubSyncArr-Ng automatically detects the change and resyncs!
- ↻ **Interactive Circuit Breaker Reset**: Reset a skipped engine from its file-result chip or file-log dialog after three consecutive failures.
- 📁 **Extended Video Formats**: Native support for `.mkv`, `.mp4`, `.avi`, `.mov`, `.ts`, `.m4v`, `.webm`, `.wmv`, and `.flv`.

---

## ⚙️ Synchronization Engines

No single subtitle synchronization algorithm works perfectly for every scenario (movies, TV shows, PAL/NTSC frame rate changes, commercial breaks, noisy audio, or sparse forced dialogue). SubSyncArr-Ng enables **four complementary engines by default**:

```
                        Input subtitle (.srt)
                                 │
          ┌───────────────┬───────┴───────┬───────────────┐
          ▼               ▼               ▼               ▼
      ffsubsync       autosubsync        alass          subsync
          │               │               │               │
          ▼               ▼               ▼               ▼
   .ffsubsync.srt  .autosubsync.srt    .alass.srt     .subsync.srt
```

### 1. `ffsubsync` (Fast Forward Subtitle Sync)

- **Technology**: Python + WebRTC Voice Activity Detection (VAD) + Fast Fourier Transform (FFT).
- **How it works**: Uses ffmpeg to extract the audio stream and translates both the audio voice activity and the subtitle timestamps into mathematical signals. It applies FFT-accelerated cross-correlation to find the optimal global linear offset and speed skew.
- **Best for**: Standard movie releases, linear delays (e.g. subtitles starting 5 seconds too late), and frame-rate conversions (e.g. 23.976 fps to 25.000 fps).
- **Speed**: Extremely fast (typically 5–15 seconds).
- **Output**: `<filename>.<lang>.ffsubsync.srt`
- **Success check**: The app checks ffsubsync's Python API result as well as the output file. An upstream CLI exit code of zero alone can also mean synchronization failed. For non-Docker installs, set `FFSUBSYNC_PYTHON` to the Python interpreter in your ffsubsync environment.

### 2. `autosubsync` (Acoustic Feature & Speech Detection)

- **Technology**: Python + NumPy/SciPy + Pretrained Neural Acoustic Model.
- **How it works**: Computes Mel-Frequency Cepstral Coefficients (MFCC) and energy spectrograms from the audio track. A trained machine learning model identifies speech frames and computes correlation curves against dialogue blocks across a spectrum of candidate skew factors.
- **Best for**: Clean movie dialogue and studio audio tracks where speech cadence can be reliably matched.
- **Special Handling in Ng**: Autosubsync skips forced subtitles by default because their dialogue is sparse; the other selected engines still run. Internal parallelism defaults to 1 to reduce memory use. `AUTOSUBSYNC_MAX_SHIFT_SECS` optionally sets its maximum timestamp shift.
- **Output**: `<filename>.<lang>.autosubsync.srt`

### 3. `alass` (Automatic Language-Agnostic Subtitle Synchronization)

- **Technology**: Rust + Dynamic Programming Alignment.
- **How it works**: Analyzes pauses and voice segments using advanced dynamic programming. Unlike pure linear-shift tools, `alass` can split subtitles into independent segments and align each chunk separately.
- **Best for**: TV shows with commercial breaks, Director's Cut vs Theatrical releases, or video files where scenes have been added or removed in the middle of the timeline.
- **Speed**: Blazing fast native Rust execution (typically 3–10 seconds).
- **Output**: `<filename>.<lang>.alass.srt`
- **Extra options**: `ALASS_EXTRA_ARGS` accepts quoted/escaped CLI arguments, such as `--no-split --split-penalty 15`. They are parsed into an argument array without shell expansion or command execution.

### 4. `subsync` (Subtitle Speech Synchronizer)

- **Source**: [neck0l/subsync](https://github.com/neck0l/subsync), the modernized SubSync fork, pinned in the Docker build.
- **How it works**: Recognizes words in the video's audio and correlates them with subtitle words to correct delay and pace. Different subtitle/audio languages require an available dictionary from upstream.
- **Output**: `<filename>.<lang>.subsync.srt`, always UTF-8. Legacy-encoded input is normalized temporarily; the original source is preserved unless replacement is explicitly enabled.
- **Engine selection**: All four engines are enabled by default (`INCLUDE_ENGINES=ffsubsync,autosubsync,alass,subsync`). Set `INCLUDE_ENGINES=subsync` to use it alone, or specify a subset to choose engines explicitly.
- **Languages**: Subtitle language comes from the filename (`movie.en.srt`, `movie.ron.forced.srt`) or `SUBSYNC_SUB_LANG`. Reference language comes from the selected audio stream's metadata or `SUBSYNC_REF_LANG`. Set the latter when audio metadata is missing or wrong. These settings accept upstream's two- or three-letter language codes, for example `en` / `eng`.
- **Language compatibility**: Common ISO aliases are normalized to upstream's model keys (`ron` → `rum`, `deu` → `ger`, `fra` → `fre`). Explicit unsupported language overrides fail clearly. The fork's language table and available assets limit support; selecting a speech backend does not add missing language entries.
- **Audio selection**: Uses the first audio stream. `SUBSYNC_REF_STREAM` selects an explicit **1-based absolute container stream number**, counting video and other streams too. Without `SUBSYNC_REF_LANG`, ffprobe reads that stream's language and normalizes it to the upstream model key. Missing or unsupported metadata fails with instructions to set `SUBSYNC_REF_LANG`. This override sets the language of the selected stream; it does not choose a different audio track.
- **Models and dictionaries**: Downloaded automatically on first use. The Docker build copies the local configuration template from `assets/subsync/config.py.template`, based on the pinned SubSync source with its asset URL changed to the original project's catalog because the fork's URL returns 404. Its license is included in `assets/subsync/LICENSE.txt`. Internet access is needed for uncached assets; missing languages/models/dictionaries fail with engine logs. Docker persists this cache at `/app/data/subsync`, covered by the existing `/app/data` volume. Allow time for downloads within `SYNC_ENGINE_TIMEOUT_MS`.
- **Concurrency and timeout**: `MAX_CONCURRENT_SYNC_TASKS` controls concurrent subtitle files for SubSync too; `SUBSYNC_JOBS=1` separately limits each process's internal decoder workers. The app waits for each starting process to confirm its assets are ready before launching another SubSync process. If a model or dictionary is missing, further launches wait for its download to finish; alignment then runs concurrently under a shared cache read lock. Installation uses an exclusive lock, waiting for active readers to finish. Cached assets are reused without checking for updates on each invocation. The engine timeout includes startup queueing, metadata probing and lock waiting. A timeout releases the lock automatically.
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
`pkg-config`, and a C++ compiler on Debian Bookworm). Also install `ffmpeg` for
the ffprobe runtime command. Install SubSync in a Python venv and set
`SUBSYNC_PYTHON` to that venv's Python interpreter. The Dockerfile
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
   - If an engine fails or reports insufficient fit, the remaining engines still run. A file can therefore have both passed and failed engine results.
5. **Database & History**: Results and timestamps are recorded in SQLite. Full run logs are stored in a `logs/` directory beside the database; per-engine stdout/stderr is retained with file results.

---

## 🚀 Quick Start

### Git source builds

All four engines are built inside dedicated Docker builder stages. The runtime
image contains installed Python environments and the compiled Rust executable;
the repository's old `bin/alass` executable is excluded from the build context.

All engine stages and the application builder reuse one `build-base` stage, so
Python, compilers, and media development libraries are installed once. Only the
alass stage adds the Rust toolchain. Each engine declares its own revision build
argument, keeping the other engine stages cached when one revision changes.
Application builds copy only their source and configuration; README and Dockerfile
changes do not trigger TypeScript compilation. Keep Docker's build cache to reuse
these stages on subsequent builds; `--no-cache` forces them to run again.

The defaults pin the latest upstream default-branch commits checked on
**2026-10-27**:

| Engine      | Upstream                                                        | Commit                                     | Docker target         |
| :---------- | :-------------------------------------------------------------- | :----------------------------------------- | :-------------------- |
| ffsubsync   | [smacke/ffsubsync](https://github.com/smacke/ffsubsync)         | `de310ac6944b8260431a48ee741e7063cec49b0f` | `ffsubsync-builder`   |
| autosubsync | [oseiskar/autosubsync](https://github.com/oseiskar/autosubsync) | `b392da2713aafe6de83e08e2571198988612febc` | `autosubsync-builder` |
| alass       | [kaegi/alass](https://github.com/kaegi/alass)                   | `874f02d9577182752a0f969b6d6b98fd65bdf1fc` | `alass-builder`       |
| SubSync     | [neck0l/subsync](https://github.com/neck0l/subsync)             | `1ff7bc91b87fe6644250323b8add790f8a9df2f2` | `subsync-builder`     |

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
      - INCLUDE_ENGINES=ffsubsync,autosubsync,alass,subsync
      - REPLACE_ORIGINAL_SUBTITLE=false
      - AUTOSUBSYNC_PARALLELISM=1
      - AUTOSUBSYNC_SKIP_FORCED=true
      - DELETE_ORPHANED_SRT=true
      # Optional engine overrides; omit to use automatic/default behavior:
      # - AUTOSUBSYNC_MAX_SHIFT_SECS=120
      # - ALASS_EXTRA_ARGS=--no-split --split-penalty 15
      # - SUBSYNC_SUB_LANG=ron
      # - SUBSYNC_REF_LANG=eng
      # - SUBSYNC_REF_STREAM=2
      # - SUBSYNC_JOBS=1
      # - SYNC_ENGINE_TIMEOUT_MS=1800000
```

Run the container:

```bash
docker compose up -d
```

After pulling application or engine-build changes, rebuild the image:

```bash
docker compose up -d --build
```

After editing only `environment`, run `docker compose up -d` to recreate the
changed service; `docker compose restart` does not apply new environment values.
SubSync may download language models or dictionaries on first use. Keep
`/app/data` mounted, allow time for downloads, and set `SUBSYNC_REF_LANG` when
the selected audio stream lacks supported language metadata.

Open your browser at **`http://localhost:3030`** (or your server's IP address on port `3030`).

---

## 📋 Configuration Options

Set runtime variables under the service's `environment` in Docker Compose or
pass them with `docker run -e NAME=value`. Paths refer to locations **inside the
container**. Defaults below describe the application/image; the Compose example
sets its own user/group IDs and timezone.

### Scanning and engine selection

| Variable                    | Default                               | Description                                                                                                                                                 |
| :-------------------------- | :------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCAN_PATHS`                | `/scan_dir`                           | Comma-separated absolute scan roots, such as `/movies,/tv`; mount the corresponding host directories.                                                       |
| `EXCLUDE_PATHS`             | _(none)_                              | Comma-separated directory prefixes to exclude from scans.                                                                                                   |
| `SYNC_LANGUAGES`            | _(none)_                              | Comma-separated language tags, e.g. `en,ron`. Matches the final dot-separated filename tag immediately before `.srt`; unset scans all languages.            |
| `CRON_SCHEDULE`             | `0 0 * * *`                           | Five-field cron schedule in the container's timezone. Use `disabled` for manual scans only.                                                                 |
| `MAX_CONCURRENT_SYNC_TASKS` | `1`                                   | Number of subtitle files processed concurrently. Engines execute sequentially within each file.                                                             |
| `INCLUDE_ENGINES`           | `ffsubsync,autosubsync,alass,subsync` | Selected engines, in execution order. Names are trimmed; an unset or empty list uses all four. Set a subset explicitly when needed.                         |
| `REPLACE_ORIGINAL_SUBTITLE` | `false`                               | Set `true` to move a successful engine output over the original subtitle. Requires exactly one selected engine; ignored when multiple engines are selected. |
| `DELETE_ORPHANED_SRT`       | `true`                                | Deletes subtitles without a matching video and their engine-suffixed copies. Set `false` to retain them.                                                    |

When upgrading from a three-engine deployment, update an explicit
`INCLUDE_ENGINES=ffsubsync,autosubsync,alass` value to include `subsync`. A source
with only the earlier three outputs remains eligible until the selected fourth
engine's output is available.

### Output filenames

| Variable             | Default       | Example output             |
| :------------------- | :------------ | :------------------------- |
| `FFSUBSYNC_SUFFIX`   | `ffsubsync`   | `movie.en.ffsubsync.srt`   |
| `AUTOSUBSYNC_SUFFIX` | `autosubsync` | `movie.en.autosubsync.srt` |
| `ALASS_SUFFIX`       | `alass`       | `movie.en.alass.srt`       |
| `SUBSYNC_SUFFIX`     | `subsync`     | `movie.en.subsync.srt`     |

Standard engine output suffixes are excluded from discovery even when that
engine is disabled. Custom suffixes are recognized only for enabled engines, so
an inactive custom suffix cannot hide original language-tagged subtitles. Before
disabling an engine with a custom suffix, move or exclude its generated files if
they should remain outside later scans.

All engines require a regular, nonempty output before reporting success or
skipping an existing result. Empty outputs are retried even when input
fingerprints match a previous run. Failed/partial outputs are removed, and media
paths are passed as literal process arguments. Original replacement deliberately
consumes the generated copy; the fingerprint cache prevents endless reprocessing
when that copy has been consumed by replacement or an external tool.

### ffsubsync, autosubsync, and alass

| Variable                     | Default                     | Description                                                                                                                                                                                                                     |
| :--------------------------- | :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FFSUBSYNC_PYTHON`           | `/opt/ffsubsync/bin/python` | Interpreter containing ffsubsync. Runs the bundled API bridge, which checks the structured synchronization result as well as process exit and output. Set this to your ffsubsync environment's Python for a non-Docker install. |
| `AUTOSUBSYNC_PARALLELISM`    | `1`                         | Internal autosubsync worker count, separate from file-level concurrency.                                                                                                                                                        |
| `AUTOSUBSYNC_MAX_SHIFT_SECS` | _(upstream default)_        | Optional maximum timestamp shift in **seconds**, passed as `--max_shift_secs`. Omit to use the bundled upstream version's default.                                                                                              |
| `AUTOSUBSYNC_SKIP_FORCED`    | `true`                      | Skip autosubsync for forced subtitles; other selected engines still run. Set `false` to attempt autosubsync too.                                                                                                                |
| `ALASS_EXTRA_ARGS`           | _(none)_                    | Extra CLI options, e.g. `--no-split --split-penalty 15` or `--encoding-inc "utf-8"`. Quotes and escapes form arguments; shell variables, substitutions, and operators are passed literally.                                     |

### SubSync speech alignment

| Variable                | Default                              | Description                                                                                                                                                                                                           |
| :---------------------- | :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUBSYNC_SPEECH_ENGINE` | `sphinx`                             | `sphinx`, `vosk`, or `whisper`. The image builds the PocketSphinx backend; `vosk`/`whisper` require a separately built CLI with the matching native backend.                                                          |
| `SUBSYNC_SUB_LANG`      | _(automatic)_                        | Subtitle language override. Otherwise inferred from the original filename, with upstream detection used when no tag is available. Accepts supported two-/three-letter aliases, e.g. `en`, `eng`, `ron`.               |
| `SUBSYNC_REF_LANG`      | _(audio metadata)_                   | Audio language override. Set it when metadata is missing or unsupported. It describes the selected stream's language; use `SUBSYNC_REF_STREAM` to select a different stream.                                          |
| `SUBSYNC_REF_STREAM`    | _(first audio stream)_               | Positive **1-based absolute container stream number**, including video and other streams. For example, a video stream followed by an audio stream makes that audio stream number `2`.                                 |
| `SUBSYNC_PYTHON`        | `/opt/subsync/bin/python`            | Interpreter containing the pinned SubSync fork. Runs the bundled bridge, which coordinates concurrent cache readers and missing-asset downloads. Set this to your SubSync venv's Python for a non-Docker install.     |
| `SUBSYNC_JOBS`          | `1`                                  | Positive integer limiting internal decoder workers per process. File concurrency follows `MAX_CONCURRENT_SYNC_TASKS`.                                                                                                 |
| `SUBSYNC_FFPROBE_PATH`  | `/usr/bin/ffprobe`                   | Direct metadata-probe executable. Its invocation bypasses the image's PATH wrapper so timeout handling reaches the probe process.                                                                                     |
| `SUBSYNC_LOCK_PATH`     | `~/.config/subsync/.subsyncarr.lock` | Shared read lock during alignment; exclusive lock for missing-asset installation. All instances sharing the cache must use the same lock file. The image links `~/.config/subsync` to persistent `/app/data/subsync`. |

Language models and translation dictionaries are downloaded on first use and
reused from `/app/data/subsync`. Runs with every required asset cached skip update checks;
fetching a missing asset can also update other assets required by that job. Keep that directory on persistent storage using
the `/app/data` volume. SubSync normalizes common aliases such as `ron` → `rum`
and `deu` → `ger`; available languages and dictionaries depend on its upstream
assets. Changing `SUBSYNC_SPEECH_ENGINE` alone installs neither a backend nor
additional language support.

To override languages while retaining all four default engines:

```yaml
environment:
  - INCLUDE_ENGINES=ffsubsync,autosubsync,alass,subsync
  - SUBSYNC_SUB_LANG=ron
  - SUBSYNC_REF_LANG=eng
  - SUBSYNC_JOBS=1
```

### Engine timeouts

| Variable                 | Default   | Description                                                                                                        |
| :----------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------- |
| `SYNC_ENGINE_TIMEOUT_MS` | `1800000` | Engine timeout in **milliseconds**: 30 minutes by default.                                                         |
| `SYNC_TIMEOUT`           | _(unset)_ | Alternative timeout in positive integer **seconds**. A valid value takes precedence over `SYNC_ENGINE_TIMEOUT_MS`. |

Use one timeout variable to avoid ambiguity. For example,
`SYNC_ENGINE_TIMEOUT_MS=3600000` or `SYNC_TIMEOUT=3600` allows one hour. SubSync's
budget includes startup queueing, audio metadata probing and waiting for its cache lock, so allow
time for first-use asset downloads and queued invocations.

### Web server and Docker runtime

| Variable           | Image/application default           | Description                                                                                                                                                                         |
| :----------------- | :---------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_PORT`         | `3000`                              | Internal HTTP/WebSocket port. Update the Compose port mapping if this changes.                                                                                                      |
| `WEB_HOST`         | `0.0.0.0`                           | Listen address inside the container. The default supports published Docker ports.                                                                                                   |
| `PUID`             | `1000`                              | UID used by the application for mounted files. The entrypoint adjusts the `node` user and ownership of `/app/data`.                                                                 |
| `PGID`             | `1000`                              | GID used by the application. The supplied Compose file uses `${PGID:-100}`; choose the group matching your media permissions.                                                       |
| `TZ`               | _(not explicitly set by the image)_ | Container timezone for cron and timestamps, e.g. `Europe/Bucharest`. The Compose example sets `Europe/Rome`.                                                                        |
| `NODE_OPTIONS`     | `--max-old-space-size=512`          | Node.js options; this default limits its JavaScript heap to 512 MiB. Python, FFmpeg, and native engine memory are separate from the Node heap.                                      |
| `PYTHONUNBUFFERED` | `1`                                 | Enables unbuffered Python output for streamed engine logs.                                                                                                                          |
| `PYTHONWARNINGS`   | `ignore::UserWarning`               | Python warning filter inherited by engine processes.                                                                                                                                |
| `PATH`             | _(image executable search path)_    | The image prefixes `/opt/subsync/bin`, `/opt/ffsubsync/bin`, then `/opt/autosubsync/bin`. Preserve SubSync's first position: ffsubsync also provides an executable named `subsync`. |

### Database, logs, and retention

| Variable                           | Default                        | Description                                                                                                                                  |
| :--------------------------------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PATH`                          | `/app/data/subsyncarr-plus.db` | SQLite database location. Run-log files are stored in a sibling `logs/` directory; persist the parent directory.                             |
| `LOG_BUFFER_SIZE`                  | `1000`                         | Maximum entries in the engine's in-memory run-log ring. Per-file log buffers and the dashboard's live-output view have separate bounds.      |
| `RETENTION_KEEP_RUNS_DAYS`         | `30`                           | Age limit for database run/file-result records and external `.log` files. Run records use their start time; log files use modification time. |
| `RETENTION_TRIM_LOGS_DAYS`         | `7`                            | Age threshold for trimming the legacy `runs.logs` database field. Current external run-log files are retained until the keep-runs age limit. |
| `RETENTION_MAX_LOG_SIZE`           | `10000`                        | Characters retained from old legacy database log text before appending a trim marker. This does not cap external log-file size.              |
| `RETENTION_CLEANUP_INTERVAL_HOURS` | `24`                           | Interval between cleanup passes. An initial cleanup also runs about five seconds after server startup.                                       |

### Docker build arguments

`FFSUBSYNC_COMMIT`, `AUTOSUBSYNC_COMMIT`, `ALASS_COMMIT`, and `SUBSYNC_COMMIT`
select engine source revisions **at image build time**. Their defaults are the
full SHAs in the [Git source builds](#git-source-builds) table. Pass an override
using `--build-arg`; for example, to rebuild with the currently documented SubSync
revision:

```bash
docker compose build \
  --build-arg SUBSYNC_COMMIT=1ff7bc91b87fe6644250323b8add790f8a9df2f2 \
  subsyncarr
docker compose up -d
```

Use a different full commit SHA to refresh that engine. Inspect
`/app/engine-sources.json` or the `io.subsyncarr.<engine>.revision` image labels
to identify the installed source revisions.

### Host-side Compose variables

The repository's supplied `docker-compose.yaml` also expands these host-side
variables from your shell or a `.env` file beside the Compose file:

| Variable         | Default                                | Description                                                                                           |
| :--------------- | :------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `DATA`           | _(required for supplied volume paths)_ | Host base directory containing `Multimedia/Film` and `Multimedia/Serie Tv`.                           |
| `DOCKER_APPDATA` | _(required for supplied volume paths)_ | Host parent directory of the persistent `subsyncarr` data directory.                                  |
| `PUID`           | `1000`                                 | Passed into the container as its application UID.                                                     |
| `PGID`           | `100`                                  | Passed into the container as its application GID; this Compose fallback overrides the image's `1000`. |
| `TZ`             | `Europe/Rome`                          | Passed into the container as its timezone.                                                            |

For example, adapt these host paths and IDs to your installation:

```dotenv
DATA=/mnt/storage
DOCKER_APPDATA=/mnt/appdata
PUID=1000
PGID=1000
TZ=Europe/Bucharest
```

The Quick Start example uses explicit host paths instead; either form maps the
same container paths used by `SCAN_PATHS` and `DB_PATH`.

---

## 🖥️ Web UI Guide

The dashboard presents run status and engine details together:

1. **Overview and controls**: Connection status, update age, persistent light/dark
   theme, **Start full run**, **Scan specific path**, and **Stop run**. The folder
   picker browses configured scan roots and supports multiple selections.
2. **Run summary**: Files to process, active/queued files, completed/skipped/failed
   counts, and run duration. Files to process excludes pre-synchronized files;
   skipped includes them. Discovery has its own state, and the latest historical
   run is restored when the server is idle.
3. **Active run**: Compact file rows show the current engine, individual engine
   results, **Log**, and **Skip**. **Engine time** is the sum of reported engine
   durations, excluding unfinished work; run duration measures elapsed run time.
   The progress bar counts engine tasks and excludes file-level pre-sync markers.
   **Full log** opens the stored run log. Combined **Live output** can be paused
   while incoming output continues to be buffered.
4. **Library and engines**: Configured folders, excluded paths, next scheduled
   scan, and separate pass/fail/skip totals for the selected engines. Engine chips
   use **F** = ffsubsync, **Au** = autosubsync, **Al** = alass, and **S** = subsync.
   Hover a chip for its message and reported duration; a circuit-breaker skip has
   a reset action.
5. **Recent file results**: Search full subtitle paths, filter by status, and
   inspect file logs with captured stdout/stderr. **Clear list** hides finished
   rows without deleting subtitle files or resetting run totals.
6. **Run history**: Start time, status, file counts, all four engine columns,
   duration, and run logs. Nonzero result counts open category details. Engine
   columns display passed/failed counts, with skipped counts in the tooltip.

On narrow screens, panels stack and wide tables scroll horizontally. Missing
historical details are marked unavailable, and a lost live connection displays
a stale-data notice while reconnecting.

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
