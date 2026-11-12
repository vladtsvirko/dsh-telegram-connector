// The browser half is plain JavaScript in the client-module format; tsc builds
// the host half only. Copy it beside the compiled entry so ./client and
// dsh.client resolve after a build.
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })
copyFileSync('src/client.js', 'lib/client.js')
