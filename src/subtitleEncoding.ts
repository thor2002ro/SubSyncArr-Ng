import chardet from 'chardet';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export async function withUtf8Subtitle<T>(
  srtPath: string,
  onLog: ((chunk: string) => void) | undefined,
  process: (utf8Path: string) => Promise<T>,
): Promise<T> {
  const source = await readFile(srtPath);

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(source);
    return process(srtPath);
  } catch {
    const encoding = chardet.detect(source);
    if (!encoding) throw new Error(`Could not detect subtitle encoding: ${srtPath}`);

    let subtitle: string;
    try {
      subtitle = new TextDecoder(encoding, { fatal: true }).decode(source);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Unsupported or invalid subtitle encoding ${encoding}: ${srtPath}: ${reason}`);
    }

    const directory = await mkdtemp(join(tmpdir(), 'subsyncarr-utf8-'));
    const path = join(directory, 'input.srt');
    try {
      await writeFile(path, subtitle, 'utf8');
      onLog?.(`Detected ${encoding} subtitle encoding; using a temporary UTF-8 copy\n`);
      return await process(path);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
