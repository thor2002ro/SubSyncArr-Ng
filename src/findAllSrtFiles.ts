import { readdir } from 'fs/promises';
import { basename, extname, join } from 'path';
import { getEnabledEngines, getSuffixConfig, ScanConfig } from './config';
import { buildOutputPath, isNonEmptyFile } from './helpers';

function isAlreadySynced(srtPath: string, engines: string[]): boolean {
  const suffixConfig = getSuffixConfig();
  const isForced = /\.forced\.srt$/i.test(srtPath) || /[-._]forced[-._]/i.test(srtPath);
  const skipForcedAutosubsync = process.env.AUTOSUBSYNC_SKIP_FORCED !== 'false';

  return engines.every((engine) => {
    if (engine === 'autosubsync' && isForced && skipForcedAutosubsync) {
      return true;
    }
    const suffix = suffixConfig[engine as keyof typeof suffixConfig] || engine;
    const outputPath = buildOutputPath(srtPath, suffix);
    return isNonEmptyFile(outputPath);
  });
}

function matchesLanguageFilter(fileName: string, languages: string[]): boolean {
  if (languages.length === 0) return true;

  // Extract language tag from filename like "movie.en.srt" or "movie.eng.srt"
  const parts = basename(fileName, '.srt').split('.');
  if (parts.length < 2) return false;

  const langTag = parts[parts.length - 1].toLowerCase();
  return languages.some((lang) => lang.toLowerCase() === langTag);
}

export interface ScanResult {
  files: string[];
  skippedCount: number;
  skippedFiles: string[];
}

export async function findAllSrtFiles(config: ScanConfig): Promise<ScanResult> {
  const engines = getEnabledEngines();
  const languages =
    process.env.SYNC_LANGUAGES?.split(',')
      .map((l) => l.trim())
      .filter(Boolean) || [];
  const files: string[] = [];
  const skippedFiles: string[] = [];
  let skippedCount = 0;

  if (languages.length > 0) {
    console.log(`${new Date().toLocaleString()} Language filter active: ${languages.join(', ')}`);
  }

  const suffixConfig = getSuffixConfig();
  // Standard output markers remain recognizable after changing engines.
  // An inactive custom suffix might be a source language tag (e.g. eng).
  const syncedSuffixes = [
    ...Object.keys(suffixConfig),
    ...engines.map((engine) => suffixConfig[engine as keyof typeof suffixConfig] || engine),
  ].map((suffix) => `.${suffix}.`);

  async function scan(directory: string): Promise<void> {
    // Check if this directory should be excluded
    if (config.excludePaths.some((excludePath) => directory.startsWith(excludePath))) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (
        entry.isFile() &&
        extname(entry.name).toLowerCase() === '.srt' &&
        !syncedSuffixes.some((suffix) => entry.name.includes(suffix)) &&
        matchesLanguageFilter(entry.name, languages)
      ) {
        if (isAlreadySynced(fullPath, engines)) {
          skippedCount++;
          skippedFiles.push(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    }
  }

  // Scan all included paths
  for (const includePath of config.includePaths) {
    await scan(includePath);
  }

  if (skippedCount > 0) {
    console.log(`${new Date().toLocaleString()} Skipped ${skippedCount} already-synced SRT files`);
  }

  return { files, skippedCount, skippedFiles };
}
