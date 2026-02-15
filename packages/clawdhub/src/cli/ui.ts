import { spawn } from 'node:child_process'
import { stdin } from 'node:process'
import { confirm, isCancel } from '@clack/prompts'
import ora from 'ora'

export async function promptHidden(prompt: string) {
  if (!stdin.isTTY) return ''
  process.stdout.write(prompt)
  const chunks: Buffer[] = []
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise<string>((resolvePromise) => {
    function onData(data: Buffer) {
      const text = data.toString('utf8')
      if (text === '\r' || text === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolvePromise(Buffer.concat(chunks).toString('utf8').trim())
        return
      }
      if (text === '\u0003') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        fail('Canceled')
      }
      if (text === '\u007f') {
        chunks.pop()
        return
      }
      chunks.push(data)
    }
    stdin.on('data', onData)
  })
}

export async function promptConfirm(prompt: string) {
  const answer = await confirm({ message: prompt })
  if (isCancel(answer)) return false
  return Boolean(answer)
}

export function openInBrowser(url: string) {
  const args =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  const [command, ...commandArgs] = args
  if (!command) return

  const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true })

  child.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('')
      console.log('Could not open browser automatically.')
      console.log('Please open this URL manually:')
      console.log('')
      console.log(`  ${url}`)
      console.log('')
    }
  })

  child.unref()
}

export function isInteractive() {
  return Boolean(process.stdout.isTTY && stdin.isTTY)
}

export function createSpinner(text: string) {
  return ora({ text, spinner: 'dots', isEnabled: isInteractive() }).start()
}

export function formatError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}
