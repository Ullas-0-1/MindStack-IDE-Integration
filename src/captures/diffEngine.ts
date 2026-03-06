import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class DiffEngine {
    /**
     * Compute Git diff since last commit for a workspace or file
     */
    static async getGitDiff(workspacePath: string, filePath?: string): Promise<string> {
        return new Promise((resolve) => {
            const cmd = filePath ? `git diff HEAD -- "${filePath}"` : `git diff HEAD`;
            cp.exec(cmd, { cwd: workspacePath, maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
                if (stdout) {
                    resolve(stdout.length > 50000 ? stdout.substring(0, 50000) + '\n...[TRUNCATED]' : stdout);
                } else {
                    resolve('');
                }
            });
        });
    }

    /**
     * Takes two strings and runs `diff -u` to generate a lightweight local hybrid differ
     */
    static async computeTextDiff(oldText: string, newText: string, fileName: string): Promise<string> {
        return new Promise((resolve) => {
            const tempDir = os.tmpdir();
            const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');
            const oldPath = path.join(tempDir, `old_${Date.now()}_${safeName}`);
            const newPath = path.join(tempDir, `new_${Date.now()}_${safeName}`);

            try {
                fs.writeFileSync(oldPath, oldText);
                fs.writeFileSync(newPath, newText);

                // Use OS diff command
                cp.exec(`diff -u "${oldPath}" "${newPath}"`, { maxBuffer: 1024 * 500 }, (error, stdout) => {
                    // diff command returns exit code 1 if differences found, 0 if identical.
                    try {
                        fs.unlinkSync(oldPath);
                        fs.unlinkSync(newPath);
                    } catch (e) { }
                    resolve(stdout ? stdout : '');
                });
            } catch (e) {
                // Return fallback if fs write failed
                resolve(oldText === newText ? '' : 'Binary or un-diffable file difference.');
            }
        });
    }
}
