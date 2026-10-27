import { existsSync, statSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { execPromise, isNonEmptyFile, ProcessingResult } from './helpers';
import { withUtf8Subtitle } from './subtitleEncoding';

interface EngineCommand {
  file: string;
  args: string[];
}

export async function runSyncEngine(
  srtPath: string,
  outputPath: string,
  onLog: ((chunk: string) => void) | undefined,
  makeCommand: (inputPath: string) => EngineCommand,
): Promise<ProcessingResult> {
  if (isNonEmptyFile(outputPath)) {
    return { success: true, message: `Skipping ${outputPath} - already processed`, skipped: true };
  }

  let canCleanup = false;
  try {
    if (resolve(outputPath) === resolve(srtPath)) {
      throw new Error('Output path must differ from the source subtitle');
    }
    if (existsSync(outputPath)) {
      const output = statSync(outputPath);
      if (!output.isFile()) throw new Error(`Output is not a regular file: ${outputPath}`);
      // Recheck after the initial skip check before removing only an empty file.
      if (output.size > 0) {
        return { success: true, message: `Skipping ${outputPath} - already processed`, skipped: true };
      }
      unlinkSync(outputPath);
    }
    canCleanup = true;

    return await withUtf8Subtitle(srtPath, onLog, async (inputPath) => {
      const command = makeCommand(inputPath);
      console.log(`${new Date().toLocaleString()} Processing: ${command.file} ${JSON.stringify(command.args)}`);
      const { stdout, stderr } = await execPromise(command.file, undefined, onLog, command.args);
      if (!isNonEmptyFile(outputPath)) {
        throw Object.assign(new Error('Engine did not produce a non-empty subtitle file'), { stdout, stderr });
      }
      return {
        success: true,
        message: `Successfully processed: ${outputPath}`,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      };
    });
  } catch (error) {
    if (canCleanup && existsSync(outputPath)) {
      try {
        unlinkSync(outputPath);
      } catch {
        // Preserve the original engine failure if cleanup also fails.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const execError = error as { stdout?: string; stderr?: string };
    return {
      success: false,
      message: /SIGTERM|timed out/i.test(message)
        ? `Timeout: ${outputPath} took longer than allowed timeout`
        : `Error processing ${outputPath}: ${message}`,
      stdout: execError.stdout || undefined,
      stderr: execError.stderr || undefined,
    };
  }
}
