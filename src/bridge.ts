/**
 * The logical bridge's durable journals.
 *
 * The bridge is the boundary between "DSH produced something" and "Telegram
 * delivered something". Today it is a module inside the connector; its on-disk
 * format is the contract, so the same journals can be served by a separate
 * process later without touching the producers.
 *
 * Two directions:
 *   out/  turns produced by DSH and not yet confirmed as delivered
 *   in/   prompts accepted from Telegram and not yet confirmed as injected
 *
 * Neither journal is a database: one small file per record, written atomically,
 * removed after acknowledgement.
 *
 * @module dsh-telegram-connector/bridge
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export interface TurnRecord {
  id: string
  sessionId: string
  assistant: string
  user?: string
  at: number
}

export interface InputRecord {
  id: string
  sessionId: string
  text: string
  at: number
}

async function writeDurable(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID().slice(0, 8)}.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

async function remove(path: string): Promise<void> {
  await unlink(path).catch(() => undefined)
}

export class SessionBridge {
  private readonly outDir: string
  private readonly inDir: string
  private readonly turns = new Map<string, TurnRecord>()
  private readonly inputs = new Map<string, InputRecord>()

  constructor(private readonly dir: string) {
    this.outDir = join(dir, 'out')
    this.inDir = join(dir, 'in')
  }

  async start(): Promise<void> {
    await mkdir(this.outDir, { recursive: true })
    await mkdir(this.inDir, { recursive: true })
    for (const [dir, map] of [[this.outDir, this.turns], [this.inDir, this.inputs]] as const) {
      for (const file of await readdir(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const record = JSON.parse(await readFile(join(dir, file), 'utf8')) as TurnRecord | InputRecord
          if (typeof record.id === 'string') map.set(record.id, record as never)
        } catch {
          // a torn file is ignored; the record is lost, not retried
        }
      }
    }
  }

  pendingTurns(): TurnRecord[] {
    return [...this.turns.values()].sort((left, right) => left.at - right.at)
  }

  pendingInputs(): InputRecord[] {
    return [...this.inputs.values()].sort((left, right) => left.at - right.at)
  }

  async recordTurn(sessionId: string, assistant: string, user?: string): Promise<TurnRecord> {
    const record: TurnRecord = {
      id: randomUUID(),
      sessionId,
      assistant,
      ...(user === undefined || user.length === 0 ? {} : { user }),
      at: Date.now(),
    }
    await writeDurable(join(this.outDir, `${record.id}.json`), record)
    this.turns.set(record.id, record)
    return record
  }

  async completeTurn(id: string): Promise<void> {
    await remove(join(this.outDir, `${id}.json`))
    this.turns.delete(id)
  }

  async recordInput(sessionId: string, text: string): Promise<InputRecord> {
    const record: InputRecord = { id: randomUUID(), sessionId, text, at: Date.now() }
    await writeDurable(join(this.inDir, `${record.id}.json`), record)
    this.inputs.set(record.id, record)
    return record
  }

  async completeInput(id: string): Promise<void> {
    await remove(join(this.inDir, `${id}.json`))
    this.inputs.delete(id)
  }
}
