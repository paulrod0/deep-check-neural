export const dynamic = 'force-dynamic'

import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

const s3 = new S3Client({ region: 'eu-west-1' })
const BUCKET = 'deep-check-models'
const PREFIX = 'training-metrics/'
const ALT_PREFIXES = ['training/v7/', 'training/v8_dinov3/', 'training/doc_forensics/']

interface EpochMetric {
  epoch: number
  train_loss: number
  train_acc: number
  val_loss: number
  val_acc: number
  auc: number
  eer: number
  lr: number
  time: number
  model?: string
}

interface ModelData {
  name: string
  architecture: string
  status: string
  epochs: EpochMetric[]
  bestAuc: number
  bestEer: number
  lastEpoch: number
  totalEpochs: number
}

async function readS3Text(key: string): Promise<string | null> {
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
    const res = await s3.send(cmd)
    return await res.Body?.transformToString() ?? null
  } catch {
    return null
  }
}

function parseMetrics(text: string): EpochMetric[] {
  return text
    .trim()
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      try { return JSON.parse(l) }
      catch { return null }
    })
    .filter(Boolean) as EpochMetric[]
}

export async function GET() {
  try {
    // List all metric files in S3
    const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX })
    const listRes = await s3.send(listCmd)
    const files = (listRes.Contents ?? [])
      .map(o => o.Key ?? '')
      .filter(k => k.endsWith('_metrics.jsonl'))

    const models: ModelData[] = []

    // Static data for completed models
    models.push({
      name: 'V3',
      architecture: 'EfficientNet-B4 + FreqBranch',
      status: 'deployed',
      epochs: [],
      bestAuc: 0.9999,
      bestEer: 0.0031,
      lastEpoch: 200,
      totalEpochs: 200,
    })

    // V4 removed — no longer relevant

    // Collect all V7/DINOv2 metric streams, then pick the best one
    const v7Candidates: { key: string; epochs: EpochMetric[] }[] = []

    // Read live training metrics from S3
    for (const key of files) {
      const text = await readS3Text(key)
      if (!text) continue

      const epochs = parseMetrics(text)
      if (epochs.length === 0) continue

      const filename = key.replace(PREFIX, '').replace('_metrics.jsonl', '')

      if (filename.includes('v7') || filename.includes('dino')) {
        v7Candidates.push({ key, epochs })
      } else {
        // Non-V7 model: derive name from filename and add directly
        const bestAuc = Math.max(...epochs.map(e => e.auc))
        const bestEer = Math.min(...epochs.map(e => e.eer))
        const lastEpoch = epochs[epochs.length - 1].epoch
        models.push({
          name: filename,
          architecture: 'Unknown',
          status: 'training',
          epochs,
          bestAuc,
          bestEer,
          lastEpoch,
          totalEpochs: 200,
        })
      }
    }

    // Read metrics from alternate S3 paths for each model
    const altModels: { prefix: string; name: string; arch: string; total: number }[] = [
      { prefix: 'training/v7/', name: 'V7-DINOv2', arch: 'DINOv2 ViT-L/14 + FreqBranch', total: 100 },
      { prefix: 'training/v8_dinov3/', name: 'V8-DINOv3', arch: 'DINOv3 ViT-L/16', total: 100 },
      { prefix: 'training/doc_forensics/', name: 'Doc-Forensics', arch: 'DINOv2 + ELA (documents)', total: 100 },
    ]

    for (const am of altModels) {
      const altKey = am.prefix + 'metrics.jsonl'
      const text = await readS3Text(altKey)
      if (!text) continue
      const epochs = parseMetrics(text)
      if (epochs.length === 0) continue

      // For V7, also check v7Candidates and pick the one with most epochs
      if (am.name === 'V7-DINOv2') {
        v7Candidates.push({ key: altKey, epochs })
      } else {
        const bestAuc = Math.max(...epochs.map(e => (e as any).auc ?? (e as any).val_auc ?? 0))
        const bestEer = Math.min(...epochs.map(e => (e as any).eer ?? (e as any).val_eer ?? 1))
        models.push({
          name: am.name,
          architecture: am.arch,
          status: 'training',
          epochs,
          bestAuc,
          bestEer,
          lastEpoch: epochs[epochs.length - 1].epoch,
          totalEpochs: am.total,
        })
      }
    }

    // Deduplicate V7: pick the candidate with the most epochs
    if (v7Candidates.length > 0) {
      const best = v7Candidates.reduce((a, b) => a.epochs.length >= b.epochs.length ? a : b)
      const bestAuc = Math.max(...best.epochs.map(e => e.auc))
      const bestEer = Math.min(...best.epochs.map(e => e.eer))
      models.push({
        name: 'V7-DINOv2',
        architecture: 'DINOv2 ViT-L/14 + FreqBranch',
        status: 'stopped',
        epochs: best.epochs,
        bestAuc,
        bestEer,
        lastEpoch: best.epochs[best.epochs.length - 1].epoch,
        totalEpochs: 100,
      })
    }

    // Also try to read logs
    const logKeys = (listRes.Contents ?? [])
      .map(o => o.Key ?? '')
      .filter(k => k.endsWith('_log.txt'))

    const logs: Record<string, string[]> = {}
    for (const key of logKeys) {
      const text = await readS3Text(key)
      if (text) {
        const name = key.replace(PREFIX, '').replace('_log.txt', '')
        logs[name] = text.trim().split('\n').slice(-20)
      }
    }

    return Response.json({
      models,
      logs,
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    return Response.json({
      models: [],
      logs: {},
      error: String(err),
      updatedAt: new Date().toISOString(),
    })
  }
}
