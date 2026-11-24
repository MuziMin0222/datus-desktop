const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * Gatekeeper reports "is damaged" when the outer app bundle has no valid
 * signature. Without a Developer ID we still must ad-hoc sign the bundle so
 * macOS sees a consistent signature; users can then clear quarantine and open
 * the app.
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  console.log(`[afterSign] ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' })
}