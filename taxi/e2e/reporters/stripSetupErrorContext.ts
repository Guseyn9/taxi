import fs from 'node:fs'
import path from 'node:path'
import type { Reporter, TestCase, TestResult, TestStep, TestError, FullResult, FullConfig } from '@playwright/test/reporter'

const { collectSecrets, makeRedactor, redactObject } = require('./reportPrivacy.cjs')
const root = path.resolve(__dirname, '../..')
const protectedProject = 'setup'

// First, and the only console reporter. A subsequent list reporter would print
// immutable raw stdout chunks before result redaction could protect them.
class PrivateTestReport implements Reporter {
  private background: string[] = []
  private counts: Record<string, number> = {}
  private outputDirs: string[] = []
  private redact = makeRedactor(collectSecrets(root))
  printsToStdio() { return true }
  onBegin(config: FullConfig) {
    this.outputDirs = config.projects.map(project => project.outputDir)
    redactObject(config.metadata, this.redact)
  }
  onStdOut(chunk: string | Buffer, test?: TestCase) {
    if (!test) this.background.push(chunk.toString())
  }
  onStdErr(chunk: string | Buffer, test?: TestCase) {
    if (!test) this.background.push(chunk.toString())
  }
  onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    step.title = test.parent.project()?.name === protectedProject ? 'Authentication step' : this.redact(step.title)
  }
  onError(error: TestError) {
    this.redact = makeRedactor(collectSecrets(root))
    redactObject(error, this.redact)
    console.error(this.redact(error.message || error.stack || 'Test runner error'))
  }
  onTestEnd(test: TestCase, result: TestResult) {
    // Successful login has just written tokens; read them before any output.
    this.redact = makeRedactor(collectSecrets(root))
    const setup = test.parent.project()?.name === protectedProject
    const removePrivateFile = (filename?: string) => {
      if (!filename) return
      if (this.outputDirs.some(directory => {
        const relative = path.relative(directory, filename)
        return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      })) fs.rmSync(filename, { force: true })
    }
    const attachments = result.attachments.filter(attachment => {
      const text = /^(?:text\/|application\/(?:json|xml))/.test(attachment.contentType)
      const media = /^(?:image\/(?:png|jpeg|webp)|video\/webm)$/.test(attachment.contentType)
      if (setup || (!text && !media)) { removePrivateFile(attachment.path); return false }
      attachment.name = this.redact(attachment.name)
      if (text) {
        if (attachment.body) attachment.body = Buffer.from(this.redact(attachment.body.toString('utf8')))
        if (attachment.path) fs.writeFileSync(attachment.path, this.redact(fs.readFileSync(attachment.path, 'utf8')))
      }
      return true
    })
    result.attachments.splice(0, result.attachments.length, ...attachments)
    if (setup) result.steps.splice(0)
    else {
      const cleanSteps = (steps: TestStep[]) => steps.forEach(step => {
        step.attachments.splice(0, step.attachments.length, ...step.attachments.filter(a => attachments.includes(a)))
        step.title = this.redact(step.title)
        redactObject(step.error, this.redact)
        redactObject(step.annotations, this.redact)
        cleanSteps(step.steps)
      })
      cleanSteps(result.steps)
    }
    redactObject(result.errors, this.redact)
    redactObject(result.error, this.redact)
    redactObject(result.annotations, this.redact)
    redactObject(test.annotations, this.redact)
    test.title = this.redact(test.title)
    // Join first: secrets split between writes must be removed too.
    for (const key of ['stdout', 'stderr'] as const) {
      const safe = this.redact(result[key].map(value => value.toString()).join(''))
      result[key].splice(0, result[key].length, ...(safe ? [safe] : []))
      if (!setup && safe) (key === 'stdout' ? process.stdout : process.stderr).write(safe)
    }
    this.counts[result.status] = (this.counts[result.status] || 0) + 1
    console.log(`${result.status}: [${this.redact(test.parent.project()?.name || '')}] ${test.title} (${result.duration} ms)`)
    if (result.status !== test.expectedStatus) for (const error of result.errors) console.error(this.redact(error.message || 'Test failed'))
  }
  onEnd(result: FullResult) {
    this.redact = makeRedactor(collectSecrets(root))
    const background = this.redact(this.background.join(''))
    if (background) process.stdout.write(background)
    console.log(`E2E ${result.status}: ${JSON.stringify(this.counts)}`)
  }
}

export default PrivateTestReport
