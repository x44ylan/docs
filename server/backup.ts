// Consistent snapshot of /data into one tar.gz while the app keeps running:
// SQLite's online backup, plus the attachment blobs. Keeps the newest 14.
//   node server/backup.ts <dir>         (inside the container: /backups)
//   node server/backup.ts --check <file> verifies an archive can be restored
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const data = process.env.DOCS_DATA ?? '/data';
const [mode, target = '/backups'] = process.argv.slice(2);

if (mode === '--check') {
    const dir = mkdtempSync(join(tmpdir(), 'docs-restore-'));
    try {
        execFileSync('tar', ['-xzf', target, '-C', dir]);
        const db = new DatabaseSync(join(dir, 'db.sqlite'), { readOnly: true });
        const ok = (db.prepare('pragma integrity_check').get() as { integrity_check: string }).integrity_check;
        const counts = db.prepare(`select (select count(*) from nodes) nodes, (select count(*) from docs) notes, (select count(*) from links) links`).get();
        console.log(JSON.stringify({ integrity: ok, ...counts }));
        if (ok !== 'ok') process.exit(1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
} else {
    const dir = mode ?? target;
    mkdirSync(dir, { recursive: true });
    const staging = mkdtempSync(join(tmpdir(), 'docs-backup-'));
    try {
        // Keep the source handle alive (and writable for WAL access) during the copy.
        const source = new DatabaseSync(join(data, 'db.sqlite'));
        await backup(source, join(staging, 'db.sqlite'));
        source.close();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = join(dir, `docs-${stamp}.tar.gz`);
        execFileSync('tar', ['-czf', `${file}.tmp`, '-C', staging, 'db.sqlite', '-C', data, 'blobs']);
        execFileSync('mv', [`${file}.tmp`, file]);
        const old = readdirSync(dir).filter(name => /^docs-.*\.tar\.gz$/.test(name)).sort().slice(0, -14);
        for (const name of old) rmSync(join(dir, name));
        console.log(file);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}
