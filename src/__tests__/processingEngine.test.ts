import { ProcessingEngine } from '../processingEngine';
import { findAllSrtFiles } from '../findAllSrtFiles';
import { findMatchingVideoFile } from '../findMatchingVideoFile';
import { generateFfsubsyncSubtitles } from '../generateFfsubsyncSubtitles';
import { generateAutosubsyncSubtitles } from '../generateAutosubsyncSubtitles';
import { buildOutputPath } from '../helpers';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('../findAllSrtFiles');
jest.mock('../findMatchingVideoFile');
jest.mock('../generateFfsubsyncSubtitles');
jest.mock('../generateAutosubsyncSubtitles');

const originalIncludeEngines = process.env.INCLUDE_ENGINES;
const originalReplaceOriginal = process.env.REPLACE_ORIGINAL_SUBTITLE;

describe('ProcessingEngine', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    if (originalIncludeEngines === undefined) delete process.env.INCLUDE_ENGINES;
    else process.env.INCLUDE_ENGINES = originalIncludeEngines;

    if (originalReplaceOriginal === undefined) delete process.env.REPLACE_ORIGINAL_SUBTITLE;
    else process.env.REPLACE_ORIGINAL_SUBTITLE = originalReplaceOriginal;
  });

  it('keeps the scan result in the run log when no files need processing', async () => {
    jest.mocked(findAllSrtFiles).mockResolvedValue({
      files: [],
      skippedCount: 3,
      skippedFiles: ['/scan/movie.en.srt', '/scan/movie.de.srt', '/scan/movie.fr.srt'],
    });

    const engine = new ProcessingEngine();
    const runLogs: string[] = [];
    let runStarted = false;

    engine.on('run:files_found', () => {
      runStarted = true;
    });
    engine.on('log', (message: string) => {
      if (runStarted) runLogs.push(message);
    });

    await engine.processRun({ includePaths: ['/scan'], excludePaths: [] });

    expect(runLogs.some((message) => message.includes('Found 0 subtitle files to process (3 already synced)'))).toBe(
      true,
    );
  });

  it('replaces the original subtitle after the only enabled engine succeeds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subsyncarr-'));
    const srtPath = join(directory, 'movie.en.srt');
    const videoPath = join(directory, 'movie.mkv');

    try {
      await writeFile(srtPath, 'original');
      process.env.INCLUDE_ENGINES = 'ffsubsync';
      process.env.REPLACE_ORIGINAL_SUBTITLE = 'true';
      jest.mocked(findAllSrtFiles).mockResolvedValue({ files: [srtPath], skippedCount: 0, skippedFiles: [] });
      jest.mocked(findMatchingVideoFile).mockReturnValue(videoPath);
      jest.mocked(generateFfsubsyncSubtitles).mockImplementation(async (inputPath) => {
        await writeFile(buildOutputPath(inputPath, 'ffsubsync'), 'synchronized');
        return { success: true, message: 'Synchronized' };
      });

      await new ProcessingEngine().processRun({ includePaths: [directory], excludePaths: [] });

      expect(await readFile(srtPath, 'utf8')).toBe('synchronized');
      await expect(readFile(buildOutputPath(srtPath, 'ffsubsync'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the original subtitle when replacement is enabled with multiple engines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subsyncarr-'));
    const srtPath = join(directory, 'movie.en.srt');
    const videoPath = join(directory, 'movie.mkv');
    const logs: string[] = [];

    try {
      await writeFile(srtPath, 'original');
      process.env.INCLUDE_ENGINES = 'ffsubsync,autosubsync';
      process.env.REPLACE_ORIGINAL_SUBTITLE = 'true';
      jest.mocked(findAllSrtFiles).mockResolvedValue({ files: [srtPath], skippedCount: 0, skippedFiles: [] });
      jest.mocked(findMatchingVideoFile).mockReturnValue(videoPath);
      jest.mocked(generateFfsubsyncSubtitles).mockImplementation(async (inputPath) => {
        await writeFile(buildOutputPath(inputPath, 'ffsubsync'), 'ffsubsync');
        return { success: true, message: 'Synchronized' };
      });
      jest.mocked(generateAutosubsyncSubtitles).mockImplementation(async (inputPath) => {
        await writeFile(buildOutputPath(inputPath, 'autosubsync'), 'autosubsync');
        return { success: true, message: 'Synchronized' };
      });

      const engine = new ProcessingEngine();
      engine.on('log', (message: string) => logs.push(message));
      await engine.processRun({ includePaths: [directory], excludePaths: [] });

      expect(await readFile(srtPath, 'utf8')).toBe('original');
      expect(logs.some((message) => message.includes('REPLACE_ORIGINAL_SUBTITLE ignored'))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
