import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// We generate the floorTiles ourselves from room dimensions
// Claude only picks room sizes, positions, enemies, items, colors
// This keeps the Claude response tiny and reliable
const LEVEL_SYSTEM = `You are a game level designer. Output ONLY raw JSON — no markdown, no backticks, no explanation. Start with { end with }.

Design a level with 3 rooms. Output this structure:

{
  "meta": {"title":"Name","perspective":"topdown","theme":"dark dungeon with torches","width":2560,"height":1920,"tileSize":32},
  "palette": {"floor":"#3a4a2a","wall":"#1a1a1a","background":"#080810","accent":"#ffaa44"},
  "rooms": [
    {"id":"start","label":"Entrance","type":"start","x":0,"y":0,"w":8,"h":8,"enemies":[],"items":[{"type":"health","x":4,"y":4,"color":"#ff4466","size":12,"label":"HP"}]},
    {"id":"combat","label":"Guard Room","type":"combat","x":11,"y":0,"w":10,"h":8,"enemies":[{"type":"patrol","x":4,"y":4,"hp":80,"speed":60,"color":"#ff4466","size":16,"patrol":[{"x":2,"y":4},{"x":7,"y":4}]},{"type":"guard","x":7,"y":5,"hp":80,"speed":50,"color":"#dd2244","size":16,"patrol":[{"x":7,"y":2},{"x":7,"y":6}]}],"items":[{"type":"key","x":8,"y":6,"color":"#ffdd44","size":12,"label":"Boss Key"}]},
    {"id":"boss","label":"Boss Chamber","type":"boss","x":24,"y":0,"w":12,"h":10,"enemies":[{"type":"boss","x":6,"y":5,"hp":350,"speed":40,"color":"#aa00ff","size":28,"patrol":[]}],"items":[{"type":"treasure","x":10,"y":8,"color":"#ffdd44","size":14,"label":"Victory"}]}
  ],
  "connections":[{"from":"start","to":"combat","type":"open","requires":null},{"from":"combat","to":"boss","type":"locked","requires":"Boss Key"}],
  "player":{"spawnRoom":"start","spawnX":2,"spawnY":4,"speed":180,"hp":100,"color":"#00d4ff","size":14}
}

Rules:
- DO NOT include floorTiles — the server generates them automatically
- Customize palette colors, enemy colors, room labels, theme to match the user description
- Keep rooms: w between 7-12, h between 7-10
- Enemy x must be between 2 and w-3, y between 2 and h-3
- Item x must be between 2 and w-3, y between 2 and h-3
- For platformer: set perspective to "platformer"
- Boss hp must be 300+, size 26+
- Output ONLY the JSON`

// Generate floorTiles from room dimensions server-side
function generateFloorTiles(w: number, h: number): number[][] {
  return Array.from({ length: h }, (_, ri) =>
    Array.from({ length: w }, (_, ci) =>
      (ri === 0 || ri === h - 1 || ci === 0 || ci === w - 1) ? 0 : 1
    )
  )
}

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()
    console.log('Generating level:', prompt.slice(0, 120))

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1000,
      system: LEVEL_SYSTEM,
      messages: [{ role: 'user', content: `Design a level for: ${prompt}` }],
    })

    const rawText = (message.content[0] as { text: string }).text
    console.log('Response length:', rawText.length)
    console.log('Response:', rawText.slice(0, 300))

    // Extract JSON between first { and last }
    let cleaned = rawText.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    const first = cleaned.indexOf('{')
    const last  = cleaned.lastIndexOf('}')

    if (first === -1 || last === -1 || last <= first) {
      console.error('No JSON found:', cleaned.slice(0, 300))
      return NextResponse.json({ error: 'No JSON in response: ' + cleaned.slice(0, 200) }, { status: 500 })
    }

    let levelData: any
    try {
      levelData = JSON.parse(cleaned.slice(first, last + 1))
    } catch (e) {
      console.error('Parse error:', (e as Error).message)
      console.error('JSON snippet around error:', cleaned.slice(Math.max(0, first + 3400), first + 3600))
      return NextResponse.json({ error: 'JSON parse failed: ' + (e as Error).message }, { status: 500 })
    }

    // Server-side: generate floorTiles for every room
    if (!levelData.rooms?.length) {
      return NextResponse.json({ error: 'No rooms in response' }, { status: 500 })
    }

    levelData.rooms = levelData.rooms.map((room: any) => {
      const w = Math.max(7, Math.min(14, room.w || 8))
      const h = Math.max(7, Math.min(12, room.h || 8))
      room.w = w
      room.h = h
      // Always generate fresh floorTiles server-side
      room.floorTiles = generateFloorTiles(w, h)
      room.enemies = (room.enemies || []).map((e: any) => ({
        ...e,
        x: Math.max(2, Math.min(w - 3, e.x || 2)),
        y: Math.max(2, Math.min(h - 3, e.y || 2)),
        patrol: (e.patrol || []).map((p: any) => ({
          x: Math.max(1, Math.min(w - 2, p.x || 2)),
          y: Math.max(1, Math.min(h - 2, p.y || 2)),
        }))
      }))
      room.items = (room.items || []).map((item: any) => ({
        ...item,
        x: Math.max(2, Math.min(w - 3, item.x || 2)),
        y: Math.max(2, Math.min(h - 3, item.y || 2)),
      }))
      return room
    })

    if (!levelData.player) {
      const r = levelData.rooms[0]
      levelData.player = { spawnRoom: r.id, spawnX: 2, spawnY: 2, speed: 180, hp: 100, color: '#00d4ff', size: 14 }
    }

    console.log(`Level OK: ${levelData.rooms.length} rooms, perspective: ${levelData.meta?.perspective}`)
    return NextResponse.json({ levelData })

  } catch (err: unknown) {
    console.error('Unexpected error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
