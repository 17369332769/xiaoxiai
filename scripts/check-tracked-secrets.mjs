import { execFileSync } from 'node:child_process';

const suspiciousPaths = [
  'backend/.env',
];

function getTrackedFiles() {
  const output = execFileSync('git', ['ls-files'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

try {
  const trackedFiles = new Set(getTrackedFiles());
  const offenders = suspiciousPaths.filter((filePath) => trackedFiles.has(filePath));

  if (offenders.length > 0) {
    console.error('Tracked secret-like files detected:');
    offenders.forEach((filePath) => {
      console.error(`- ${filePath}`);
    });
    console.error('Remove them from git tracking before committing, for example:');
    console.error('git rm --cached backend/.env');
    process.exit(1);
  }

  console.log('No tracked secret-like files detected.');
} catch (error) {
  console.error('Failed to run tracked secret check.', error);
  process.exit(1);
}
