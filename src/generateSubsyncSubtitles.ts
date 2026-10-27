import { existsSync, statSync, unlinkSync } from 'fs';
import { mkdir } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { getSuffixConfig } from './config';
import { buildOutputPath, execPromise, getTimeoutMs, isNonEmptyFile, ProcessingResult } from './helpers';
import { withUtf8Subtitle } from './subtitleEncoding';
import { getSubsyncLanguage } from './subsyncLanguages';

async function detectReferenceLanguage(
  videoPath: string,
  refStream: string | undefined,
  timeoutMs: number,
): Promise<string> {
  // The bundled PATH wrapper forks a child; probing the binary directly keeps
  // timeout termination attached to the actual process doing media I/O.
  const executable = process.env.SUBSYNC_FFPROBE_PATH || '/usr/bin/ffprobe';
  const { stdout } = await execPromise(executable, Math.min(timeoutMs, 30000), undefined, [
    '-v',
    'error',
    '-show_entries',
    'stream=index,codec_type:stream_tags=language',
    '-of',
    'json',
    videoPath,
  ]);
  const probe = JSON.parse(stdout) as {
    streams?: { index: number; codec_type?: string; tags?: { language?: string } }[];
  };
  const stream = refStream
    ? probe.streams?.find((entry) => entry.index === Number(refStream) - 1)
    : probe.streams?.find((entry) => entry.codec_type === 'audio');
  if (!stream || stream.codec_type !== 'audio') {
    throw new Error('Selected reference stream is not audio or no audio stream was found');
  }
  const language = stream.tags?.language && getSubsyncLanguage(stream.tags.language);
  if (!language) {
    throw new Error('Cannot determine a supported audio language from metadata; set SUBSYNC_REF_LANG');
  }
  return language;
}

export async function generateSubsyncSubtitles(
  srtPath: string,
  videoPath: string,
  onLog?: (chunk: string) => void,
): Promise<ProcessingResult> {
  const outputPath = buildOutputPath(srtPath, getSuffixConfig().subsync);
  if (isNonEmptyFile(outputPath)) {
    return { success: true, message: `Skipping ${outputPath} - already processed`, skipped: true };
  }

  const deadline = Date.now() + getTimeoutMs();
  const remainingTimeout = () => Math.max(1, deadline - Date.now());
  try {
    // Read the original name: encoding normalization can replace it with input.srt.
    const languageTag = basename(srtPath).match(/\.([a-z]{2,3})(?:\.(?:forced|sdh|cc|hi))*\.srt$/i)?.[1];
    const subLang = process.env.SUBSYNC_SUB_LANG
      ? getSubsyncLanguage(process.env.SUBSYNC_SUB_LANG)
      : languageTag
        ? getSubsyncLanguage(languageTag)
        : undefined;
    let refLang = process.env.SUBSYNC_REF_LANG ? getSubsyncLanguage(process.env.SUBSYNC_REF_LANG) : undefined;
    if (process.env.SUBSYNC_SUB_LANG && !subLang) {
      throw new Error(`SUBSYNC_SUB_LANG is unsupported by SubSync: ${process.env.SUBSYNC_SUB_LANG}`);
    }
    if (process.env.SUBSYNC_REF_LANG && !refLang) {
      throw new Error(`SUBSYNC_REF_LANG is unsupported by SubSync: ${process.env.SUBSYNC_REF_LANG}`);
    }
    const speechEngine = process.env.SUBSYNC_SPEECH_ENGINE || 'sphinx';
    if (!['sphinx', 'vosk', 'whisper'].includes(speechEngine)) {
      throw new Error('SUBSYNC_SPEECH_ENGINE must be sphinx, vosk, or whisper');
    }
    const jobs = process.env.SUBSYNC_JOBS || '1';
    if (!/^[1-9]\d*$/.test(jobs) || !Number.isSafeInteger(Number(jobs))) {
      throw new Error('SUBSYNC_JOBS must be a positive integer');
    }
    const refStream = process.env.SUBSYNC_REF_STREAM;
    if (refStream && !/^[1-9]\d*$/.test(refStream)) {
      throw new Error('SUBSYNC_REF_STREAM must be a positive, 1-based stream number');
    }
    if (!refLang) refLang = await detectReferenceLanguage(videoPath, refStream, remainingTimeout());

    if (existsSync(outputPath)) {
      if (!statSync(outputPath).isFile()) throw new Error(`SubSync output is not a regular file: ${outputPath}`);
      // Upstream refuses to overwrite even a zero-byte output from a crashed run.
      unlinkSync(outputPath);
    }

    return await withUtf8Subtitle(srtPath, onLog, async (inputPath) => {
      const args = [
        '--cli',
        '--engine',
        speechEngine,
        '--jobs',
        jobs,
        'sync',
        '--sub',
        inputPath,
        '--sub-enc',
        'UTF-8',
        '--ref',
        videoPath,
        ...(refStream ? ['--ref-stream', refStream] : ['--ref-stream-by-type', 'audio']),
        '--out',
        outputPath.replace(/\{/g, '{{').replace(/\}/g, '}}'),
        '--out-enc',
        'UTF-8',
      ];
      if (subLang) args.push('--sub-lang', subLang);
      if (refLang) args.push('--ref-lang', refLang);

      // Upstream's asset locks only coordinate threads within one process.
      // Keep an OS lock for the CLI's entire lifetime so another invocation
      // cannot read a model while it is being installed or updated.
      const lockPath = process.env.SUBSYNC_LOCK_PATH || join(homedir(), '.config', 'subsync', '.subsyncarr.lock');
      await mkdir(dirname(lockPath), { recursive: true });
      console.log(`${new Date().toLocaleString()} Processing: subsync ${JSON.stringify(args)}`);
      // --no-fork replaces flock with the CLI after acquiring the lock. The
      // timeout therefore kills the lock waiter or the actual CLI, with no
      // detached child left behind. The kernel releases the lock on exit.
      const { stdout, stderr } = await execPromise('flock', remainingTimeout(), onLog, [
        '--exclusive',
        '--no-fork',
        lockPath,
        'subsync',
        ...args,
      ]);
      if (!isNonEmptyFile(outputPath)) {
        throw Object.assign(new Error('SubSync did not produce a non-empty subtitle file'), { stdout, stderr });
      }
      return {
        success: true,
        message: `Successfully processed: ${outputPath}`,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      };
    });
  } catch (error) {
    if (existsSync(outputPath)) {
      try {
        unlinkSync(outputPath);
      } catch {
        // Preserve the engine failure even if output cleanup fails.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const execError = error as { stdout?: string; stderr?: string };
    const isTimeout = /SIGTERM|timed out/i.test(message);
    return {
      success: false,
      message: isTimeout
        ? `Timeout: ${outputPath} took longer than allowed timeout`
        : `Error processing ${outputPath}: ${message}`,
      stdout: execError.stdout || undefined,
      stderr: execError.stderr || undefined,
    };
  }
}
