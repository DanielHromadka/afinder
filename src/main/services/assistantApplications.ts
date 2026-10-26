import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type { AssistantApplication } from './fileAssistantService'
const exec = promisify(execFile)

export async function assistantApplications(): Promise<AssistantApplication[]> {
  const apps: AssistantApplication[] = [{ id: 'default', label: 'System default', description: 'Use the operating system default application for this file' }]
  const mac = [
    ['text', 'TextEdit', 'Plain text, rich text and notes'],
    ['browser', 'Safari', 'HTML pages and web documents'],
    ['image', 'Preview', 'Images and PDF documents'],
    ['sheet', 'Numbers', 'Spreadsheets and tabular data'],
    ['media', 'QuickTime Player', 'Audio and video files'],
    ['code', 'Visual Studio Code', 'Programming source code, configuration files and development projects']
  ]
  if (process.platform === 'darwin') {
    for (const [id, label, description] of mac) {
      for (const base of ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')]) {
        const app = path.join(base, `${label}.app`)
        if (
          await access(app).then(
            () => true,
            () => false
          )
        ) {
          apps.push({ id, label, description, executable: '/usr/bin/open', args: ['-a', app] })
          break
        }
      }
    }
  } else if (process.platform === 'win32') {
    const candidates = [
      {
        id: 'text',
        label: 'Notepad',
        description: 'Plain text files and notes',
        executable: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe')
      },
      {
        id: 'code',
        label: 'Visual Studio Code',
        description: 'Source code and configuration',
        executable: path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs', 'Microsoft VS Code', 'Code.exe')
      },
      {
        id: 'browser',
        label: 'Microsoft Edge',
        description: 'HTML, web pages and PDF documents',
        executable: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      }
    ]
    for (const app of candidates)
      if (
        await access(app.executable).then(
          () => true,
          () => false
        )
      )
        apps.push(app)
  } else {
    for (const [id, label, description, cmd] of [
      ['text', 'Text editor', 'Plain text and notes', 'gedit'],
      ['code', 'Visual Studio Code', 'Source code and configuration', 'code'],
      ['browser', 'Firefox', 'HTML and web pages', 'firefox'],
      ['office', 'LibreOffice', 'Documents and spreadsheets', 'libreoffice'],
      ['image', 'Image viewer', 'Images and photographs', 'eog']
    ]) {
      const executable = await exec('which', [cmd], { timeout: 2000 }).then(
        (r) => r.stdout.trim(),
        () => ''
      )
      if (path.isAbsolute(executable)) apps.push({ id, label, description, executable })
    }
  }
  return apps
}
export async function openAssistantApplication(file: string, application: AssistantApplication): Promise<void> {
  // Revalidate availability and use only server-owned executable paths/arguments, never model strings.
  if (application.id === 'default') {
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
    return
  }
  const current = (await assistantApplications()).find(
    (a) => a.id === application.id && a.executable === application.executable && JSON.stringify(a.args) === JSON.stringify(application.args)
  )
  if (!current?.executable) throw new Error('Application is no longer available')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(current.executable!, [...(current.args ?? []), file], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
