import { NextRequest } from 'next/server'

const FAL_URL = 'https://fal.run/fal-ai/flux/schnell'

async function falGen(prompt: string, falKey: string): Promise<string> {
  const res = await fetch(FAL_URL, {
    method: 'POST',
    headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_size: { width: 512, height: 512 },
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: false,
    }),
  })
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const url = data.images?.[0]?.url
  if (!url) throw new Error('No image URL returned')
  return url
}

// Streaming route — sends each asset as it completes
// Client reads the stream and updates UI progressively
export async function POST(req: NextRequest) {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return new Response(JSON.stringify({ error: 'FAL_KEY not configured' }), { status: 500 })
  }

  const { theme, style, perspective, enemyTypes, playerDescription } = await req.json()
  const isTopdown = perspective !== 'platformer'
  const enemies   = (enemyTypes || ['enemy']).slice(0, 2).join(' and ')
  const styleStr  = style || 'pixel art'

  const prompts = {
    background: `${styleStr} 2D game ${isTopdown ? 'top-down overhead' : 'side-scrolling'} environment scene, ${theme}, atmospheric game background art, no characters, no UI, no text, detailed`,
    tileset:    `${styleStr} 2D game tileset sheet, 2x2 grid, 4 tiles: top-left=floor tile, top-right=wall tile, bottom-left=platform tile, bottom-right=ground tile, ${theme} style, each tile clearly separated, game asset`,
    sprites:    `${styleStr} 2D game sprite sheet, white background, 3 characters left to right: player hero (${playerDescription || 'adventurer'}), ${enemies} enemy, large boss monster, each full body facing right, no shadow, game sprite asset`,
  }

  const encoder = new TextEncoder()
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'))
      }

      try {
        // Fire all 3 in parallel, stream each result as it arrives
        const results: Record<string, string> = {}

        await Promise.all([
          falGen(prompts.background, falKey).then(url => {
            results.backgroundUrl = url
            send({ type: 'asset', key: 'backgroundUrl', url, label: 'Background' })
          }),
          falGen(prompts.tileset, falKey).then(url => {
            results.tilesetUrl = url
            send({ type: 'asset', key: 'tilesetUrl', url, label: 'Tileset' })
          }),
          falGen(prompts.sprites, falKey).then(url => {
            results.spriteSheetUrl = url
            send({ type: 'asset', key: 'spriteSheetUrl', url, label: 'Sprites' })
          }),
        ])

        send({ type: 'done', ...results, estimatedCost: '~$0.009' })

      } catch (err: unknown) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Asset generation failed' })
      }

      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
