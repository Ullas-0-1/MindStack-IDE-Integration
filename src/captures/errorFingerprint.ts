import * as crypto from 'crypto';

export function getErrorFingerprint(errorMessage: string, command: string = "unknown"): string {
    const hash = crypto.createHash('md5');
    hash.update(errorMessage.toLowerCase().trim() + command.toLowerCase().trim());
    return hash.digest('hex');
}
