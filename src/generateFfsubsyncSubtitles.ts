import { join } from 'path';
import { buildOutputPath, ProcessingResult } from './helpers';
import { getSuffixConfig } from './config';
import { runSyncEngine } from './runSyncEngine';

export async function generateFfsubsyncSubtitles(
  srtPath: string,
  videoPath: string,
  onLog?: (chunk: string) => void,
): Promise<ProcessingResult> {
  const outputPath = buildOutputPath(srtPath, getSuffixConfig().ffsubsync);
  return runSyncEngine(srtPath, outputPath, onLog, (inputPath) => ({
    file: process.env.FFSUBSYNC_PYTHON || '/opt/ffsubsync/bin/python',
    args: [join(__dirname, 'ffsubsyncBridge.py'), videoPath, '-i', inputPath, '-o', outputPath],
  }));
}
