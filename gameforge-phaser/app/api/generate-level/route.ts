import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Claude outputs MINIMAL JSON — server builds everything else
// Keeping it tiny eliminates all truncation issues
const SYSTEM = `Output ONLY raw JSON. No markdown. No backticks. Start with { end with }.

Return exactly this structure — customize values to match the description:

{"title":"Dungeon of Shadows","perspective":"topdown","theme":"dark stone dungeon with lava and torches","bgColor":"#080810","floorColor":"#3a3a2a","wallColor":"#1a1a1a","accentColor":"#ff6600","playerColor":"#00d4ff","playerSpeed":180,"rooms":[{"id":"start","label":"Entrance","x":0,"y":0,"w":8,"h":8,"enemyColor":"#888888","enemies":[],"items":[{"type":"health","x":4,"y":4}]},{"id":"combat","label":"Guard Room","x":11,"y":0,"w":10,"h":8,"enemyColor":"#ff4466","enemies":[{"x":4,"y":4,"hp":80,"speed":60,"patrol":true},{"x":7,"y":5,"hp":80,"speed":50,"patrol":false}],"items":[{"type":"key","x":8,"y":6,"label":"Boss Key"}]},{"id":"boss","label":"Boss Chamber","x":24,"y":0,"w":12,"h":10,"enemyColor":"#aa00ff","enemies":[{"x":6,"y":5,"hp":350,"speed":40,"isBoss":true}],"items":[{"type":"treasure","x":10,"y":8,"label":"Victory"}]}],"connections":[{"from":"start","to":"combat","type":"open"},{"from":"combat","to":"boss","type":"locked","requires":"Boss Key"}]}`

function makeTiles(w: number, h: number) {
  return Array.from({ length: h }, (_, r) =>
    Array.from({ length: w }, (_, c) =>
      r === 0 || r === h - 1 || c === 0 || c === w - 1 ? 0 : 1
    )
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()
    console.log('Level prompt:', prompt.slice(0, 120))

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 800,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Design a level for: ${prompt}` }],
    })

    const raw = (msg.content[0] as { text: string }).text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    console.log('Claude response length:', raw.length)

    const first = raw.indexOf('{')
    const last  = raw.lastIndexOf('}')
    if (first === -1 || last <= first) {
      return NextResponse.json({ error: 'No JSON in response: ' + raw.slice(0, 200) }, { status: 500 })
    }

    let d: any
    try {
      d = JSON.parse(raw.slice(first, last + 1))
    } catch (e) {
      console.error('Parse failed:', (e as Error).message)
      console.error('Raw JSON:', raw.slice(first, first + 300))
      return NextResponse.json({ error: 'Parse failed: ' + (e as Error).message }, { status: 500 })
    }

    // Build full levelData server-side
    const rooms = (d.rooms || []).map((room: any) => {
      const w = clamp(room.w || 8, 7, 14)
      const h = clamp(room.h || 8, 7, 12)
      const ec = room.enemyColor || '#ff4466'

      const enemies = (room.enemies || []).map((e: any) => {
        const isBoss = !!e.isBoss
        const ex = clamp(e.x || 3, 2, w - 3)
        const ey = clamp(e.y || 3, 2, h - 3)
        return {
          type: isBoss ? 'boss' : 'patrol',
          x: ex, y: ey,
          hp: e.hp || 60,
          speed: e.speed || 60,
          color: ec,
          size: isBoss ? 28 : 16,
          patrol: e.patrol
            ? [{ x: clamp(ex - 2, 1, w - 2), y: ey }, { x: clamp(ex + 2, 1, w - 2), y: ey }]
            : [],
        }
      })

      const items = (room.items || []).map((item: any) => ({
        type:  item.type || 'health',
        x:     clamp(item.x || 3, 2, w - 3),
        y:     clamp(item.y || 3, 2, h - 3),
        color: item.type === 'key' ? '#ffdd44' : item.type === 'health' ? '#ff4466' : '#ffcc00',
        size:  item.type === 'treasure' ? 14 : 12,
        label: item.label || item.type,
      }))

      return {
        id: room.id, label: room.label, type: room.type || 'combat',
        x: room.x || 0, y: room.y || 0, w, h,
        floorTiles: makeTiles(w, h),
        enemies, items,
      }
    })

    const spawnRoom = rooms.find((r: any) => r.type === 'start') || rooms[0]

    const levelData = {
      meta: {
        title:       d.title || 'Level 1',
        perspective: d.perspective || 'topdown',
        theme:       d.theme || 'dungeon',
        width: 2560, height: 1920, tileSize: 32,
      },
      palette: {
        floor:      d.floorColor  || '#3a4a2a',
        wall:       d.wallColor   || '#1a1a1a',
        platform:   d.floorColor  || '#4a3a2a',
        background: d.bgColor     || '#080810',
        accent:     d.accentColor || '#ffaa44',
      },
      rooms,
      connections: (d.connections || []).map((c: any) => ({
        from: c.from, to: c.to,
        type: c.type || 'open',
        requires: c.requires || null,
      })),
      player: {
        spawnRoom: spawnRoom?.id,
        spawnX: 2, spawnY: 3,
        speed: d.playerSpeed || 180,
        hp: 100,
        color: d.playerColor || '#00d4ff',
        size: 14,
      },
    }

    const enemies = rooms.reduce((a: number, r: any) => a + r.enemies.length, 0)
    const items   = rooms.reduce((a: number, r: any) => a + r.items.length, 0)
    console.log(`Level OK: ${rooms.length} rooms, ${enemies} enemies, ${items} items`)

    return NextResponse.json({ levelData })

  } catch (err: unknown) {
    console.error('Error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
