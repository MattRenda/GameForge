import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Increase max_tokens and use a tighter prompt with an example
const LEVEL_SYSTEM = `You are a game level designer. Output ONLY a raw JSON object. No markdown. No backticks. No explanation. Start your response with { and end with }.

Use this exact structure with 3 rooms:
{
  "meta": {"title":"Level Name","perspective":"topdown","theme":"dark dungeon with torches","width":2560,"height":1920,"tileSize":32},
  "palette": {"floor":"#3a4a2a","wall":"#1a1a1a","platform":"#4a3a2a","background":"#080810","accent":"#ffaa44"},
  "rooms": [
    {
      "id":"start","label":"Start","type":"start","x":0,"y":0,"w":8,"h":8,
      "floorTiles":[[0,0,0,0,0,0,0,0],[0,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,0],[0,0,0,0,0,0,0,0]],
      "enemies":[],
      "items":[{"type":"health","x":4,"y":4,"color":"#ff4466","size":12,"label":"HP"}]
    },
    {
      "id":"combat","label":"Guard Room","type":"combat","x":11,"y":0,"w":10,"h":8,
      "floorTiles":[[0,0,0,0,0,0,0,0,0,0],[0,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,0],[0,0,0,0,0,0,0,0,0,0]],
      "enemies":[{"type":"patrol","x":3,"y":3,"hp":80,"speed":60,"color":"#ff4466","size":16,"patrol":[{"x":2,"y":3},{"x":7,"y":3}]}],
      "items":[{"type":"key","x":8,"y":6,"color":"#ffdd44","size":12,"label":"Key"}]
    },
    {
      "id":"boss","label":"Boss","type":"boss","x":24,"y":0,"w":12,"h":10,
      "floorTiles":[[0,0,0,0,0,0,0,0,0,0,0,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,1,1,1,1,1,1,1,1,1,1,0],[0,0,0,0,0,0,0,0,0,0,0,0]],
      "enemies":[{"type":"boss","x":6,"y":5,"hp":350,"speed":45,"color":"#aa00ff","size":28,"patrol":[]}],
      "items":[{"type":"treasure","x":10,"y":8,"color":"#ffdd44","size":14,"label":"Victory"}]
    }
  ],
  "connections":[{"from":"start","to":"combat","type":"open","requires":null},{"from":"combat","to":"boss","type":"locked","requires":"Key"}],
  "player":{"spawnRoom":"start","spawnX":2,"spawnY":4,"speed":180,"hp":100,"color":"#00d4ff","size":14}
}

Customize colors, enemy types, room labels, theme, and palette to match the user description. Keep room sizes small (8x8 to 12x10). floorTiles rows must EXACTLY match h, each row EXACTLY match w. Enemy/item x,y must be on floor tile (value 1).`

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()
    console.log('Generating level:', prompt.slice(0, 120))

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      system: LEVEL_SYSTEM,
      messages: [{ role: 'user', content: `Design a level for: ${prompt}` }],
    })

    const rawText = (message.content[0] as { text: string }).text
    console.log('Response length:', rawText.length)
    console.log('Response start:', rawText.slice(0, 100))

    // Extract JSON — find first { and last }
    let cleaned = rawText.trim()
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    const firstBrace = cleaned.indexOf('{')
    const lastBrace  = cleaned.lastIndexOf('}')

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      console.error('No valid JSON found. Response:', cleaned.slice(0, 300))
      return NextResponse.json(
        { error: `No JSON found in response. Got: ${cleaned.slice(0, 200)}` },
        { status: 500 }
      )
    }

    const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
    console.log('JSON length:', jsonStr.length)

    let levelData: any
    try {
      levelData = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('Parse error:', (parseErr as Error).message)
      console.error('Failed JSON (first 400):', jsonStr.slice(0, 400))
      return NextResponse.json(
        { error: `JSON parse failed: ${(parseErr as Error).message}` },
        { status: 500 }
      )
    }

    // Validate and auto-fix rooms
    if (!levelData.rooms?.length) {
      return NextResponse.json({ error: 'No rooms in level data' }, { status: 500 })
    }

    levelData.rooms = levelData.rooms.map((room: any) => {
      const w = room.w || 8
      const h = room.h || 8
      room.w = w
      room.h = h

      if (!room.floorTiles || !Array.isArray(room.floorTiles)) {
        // Generate default floor
        room.floorTiles = Array.from({ length: h }, (_, ri) =>
          Array.from({ length: w }, (_, ci) =>
            (ri === 0 || ri === h-1 || ci === 0 || ci === w-1) ? 0 : 1
          )
        )
      } else {
        // Fix dimensions
        room.floorTiles = room.floorTiles.slice(0, h).map((row: number[]) => {
          const r = Array.isArray(row) ? row : []
          if (r.length < w) return [...r, ...Array(w - r.length).fill(0)]
          if (r.length > w) return r.slice(0, w)
          return r
        })
        while (room.floorTiles.length < h) {
          room.floorTiles.push(Array(w).fill(0))
        }
      }

      room.enemies = room.enemies || []
      room.items   = room.items   || []
      return room
    })

    if (!levelData.player) {
      const firstRoom = levelData.rooms[0]
      levelData.player = { spawnRoom: firstRoom.id, spawnX: 2, spawnY: 2, speed: 180, hp: 100, color: '#00d4ff', size: 14 }
    }

    console.log(`Level OK: ${levelData.rooms.length} rooms`)
    return NextResponse.json({ levelData })

  } catch (err: unknown) {
    console.error('Unexpected error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
