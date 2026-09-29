import { withUtf8Subtitle } from '../subtitleEncoding';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('withUtf8Subtitle', () => {
  it('provides a temporary UTF-8 copy and preserves the source bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subsyncarr-encoding-test-'));
    const srtPath = join(directory, 'movie.ron.srt');
    const source = Buffer.from([
      0x31, 0x0d, 0x0a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x2c, 0x30, 0x30, 0x30, 0x20, 0x2d, 0x2d, 0x3e,
      0x20, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x32, 0x2c, 0x30, 0x30, 0x30, 0x0d, 0x0a, 0xce, 0x6e, 0x63, 0x65,
      0x70, 0x65, 0x20, 0xba, 0x69, 0x20, 0xfe, 0x69, 0x6e, 0x65, 0x2e, 0x0d, 0x0a,
    ]);
    let temporaryPath = '';

    try {
      await writeFile(srtPath, source);
      await withUtf8Subtitle(srtPath, undefined, async (utf8Path) => {
        temporaryPath = utf8Path;
        expect(utf8Path).not.toBe(srtPath);
        expect(await readFile(utf8Path, 'utf8')).toContain('Începe şi ţine.');
      });

      expect(await readFile(srtPath)).toEqual(source);
      await expect(readFile(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
