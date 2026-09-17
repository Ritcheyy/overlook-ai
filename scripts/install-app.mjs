// Copies the freshly packaged .app into /Applications, replacing the old one.
// ditto keeps the framework bundles' relative symlinks intact; fs.cp rewrites
// them as absolute links into dist/, which breaks Chromium's helper processes.
// The unsigned bundle still carries Electron's upstream linker signature, which
// LaunchServices rejects on Apple silicon (Finder launches die silently), so
// the copy is ad-hoc signed as a whole; running it from a terminal never hit
// that check.
import { existsSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'

const built = 'dist/mac-arm64/Overlook.app'
const target = '/Applications/Overlook.app'

if (!existsSync(built)) {
  console.error(`Nothing to install: ${built} is missing. Run "pnpm package" first.`)
  process.exit(1)
}
try {
  execSync('osascript -e \'tell application "Overlook" to quit\'', { stdio: 'ignore' })
} catch {
  // Not running.
}
rmSync(target, { recursive: true, force: true })
execSync(`ditto "${built}" "${target}"`, { stdio: 'inherit' })
execSync(`codesign --force --deep --sign - "${target}"`, { stdio: 'inherit' })
execSync(`codesign --verify --deep --strict "${target}"`, { stdio: 'inherit' })
console.log(`Installed and ad-hoc signed ${target}`)
