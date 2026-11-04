// The Swift daemon only builds on macOS; CI runs the monorepo-wide
// `npm run build` on Linux, where this workspace has nothing to build.
import { execSync } from 'node:child_process';

if (process.platform === 'darwin') {
  execSync('swift build -c release', { stdio: 'inherit' });
} else {
  console.log('@autocorrect/macos: skipping swift build (not macOS)');
}
