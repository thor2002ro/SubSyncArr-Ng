import { buildOutputPath, ProcessingResult } from './helpers';
import { getSuffixConfig, getAlassExtraArgs } from './config';
import { parseCliArguments } from './cliArguments';
import { runSyncEngine } from './runSyncEngine';

export async function generateAlassSubtitles(
  srtPath: string,
  videoPath: string,
  onLog?: (chunk: string) => void,
): Promise<ProcessingResult> {
  const outputPath = buildOutputPath(srtPath, getSuffixConfig().alass);
  return runSyncEngine(srtPath, outputPath, onLog, (inputPath) => ({
    file: 'alass',
    args: [videoPath, inputPath, outputPath, ...parseCliArguments(getAlassExtraArgs())],
  }));
}
