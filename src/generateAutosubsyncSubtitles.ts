import { buildOutputPath, ProcessingResult } from './helpers';
import { getSuffixConfig } from './config';
import { runSyncEngine } from './runSyncEngine';

export function isForcedSubtitle(filePath: string): boolean {
  return /\.forced\.srt$/i.test(filePath) || /[-._]forced[-._]/i.test(filePath);
}

export async function generateAutosubsyncSubtitles(
  srtPath: string,
  videoPath: string,
  onLog?: (chunk: string) => void,
): Promise<ProcessingResult> {
  if (isForcedSubtitle(srtPath) && process.env.AUTOSUBSYNC_SKIP_FORCED !== 'false') {
    return {
      success: true,
      message: 'Skipped: autosubsync does not support forced subtitles (sparse dialogue)',
      skipped: true,
    };
  }
  const outputPath = buildOutputPath(srtPath, getSuffixConfig().autosubsync);
  return runSyncEngine(srtPath, outputPath, onLog, (inputPath) => ({
    file: 'autosubsync',
    args: [
      '--parallelism',
      process.env.AUTOSUBSYNC_PARALLELISM || '1',
      ...(process.env.AUTOSUBSYNC_MAX_SHIFT_SECS ? ['--max_shift_secs', process.env.AUTOSUBSYNC_MAX_SHIFT_SECS] : []),
      videoPath,
      inputPath,
      outputPath,
    ],
  }));
}
