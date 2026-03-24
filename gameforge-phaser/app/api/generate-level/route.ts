import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const LEVEL_SYSTEM = `You are a game level designer. You output ONLY valid JSON — no markdown, no explanation, no backticks.

Design a complete playable level based on the user's description.

Output this exact structure:
{
  "meta": {
    "title": "level name",
    "perspective": "topdown or platformer",
    "theme": "brief visual theme for art generation e.g. dark stone dungeon with lava pools and torches",
    "width": 2560,
    "height": 1920,
    "tileSize": 32
  },
  "palette": {
    "floor": "#4a5a3a",
    "wall": "#2a2a2a",
    "platform": "#5a4a3a",
    "background": "#0a0a12",
    "accent": "#ffaa44"
  },
  "rooms": [
    {
      "id": "unique_id",
      "label": "Room Name",
      "type": "start|combat|puzzle|treasure|boss",
      "x": 0,
      "y": 0,
      "w": 10,
      "h": 8,
      "floorTiles": [[1,1,1,1,1,1,1,1,1,1],[1,0,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,0,1],[1,1,1,1,1,1,1,1,1,1]],
      "enemies": [
        {"type": "patrol|guard|boss|archer", "x": 3, "y": 3, "hp": 80, "speed": 60, "color": "#ff4466", "size": 16, "patrol": [{"x":2,"y":3},{"x":7,"y":3}]}
      ],
      "items": [
        {"type": "health|key|treasure", "x": 5, "y": 5, "color": "#ffdd44", "size": 12, "label": "Key"}
      ]
    }
  ],
  "connections": [
    {"from": "room_id", "to": "room_id2", "type": "open|door|locked", "requires": null}
  ],
  "player": {
    "spawnRoom": "room_id",
    "spawnX": 2,
    "spawnY": 4,
    "speed": 180,
    "hp": 100,
    "color": "#00d4ff",
    "size": 14
  }
}

CRITICAL RULES:
- floorTiles must be EXACTLY h rows, each with EXACTLY w values (0 or 1). 1=solid, 0=empty/air.
- For topdown: surround walkable area with walls (0s on border, 1s inside).
- For platformer: 1s are platforms/ground, 0s are air. Put platforms at y rows 6-7 mainly.
- Room x,y are in TILES. Space rooms apart by at least 3 tiles for corridors.
- Enemy positions (x,y) must be on floor tiles (value=1) inside that room.
- Item positions must be on floor tiles.
- spawnX, spawnY are relative to spawnRoom position.
- Make 3-5 rooms with clear progression: start -> combat -> key -> locked door -> boss.
- Boss room has a boss enemy with 300+ hp and size 28.`

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      system: LEVEL_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0] as { text: string }).text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    const levelData = JSON.parse(raw)
    return NextResponse.json({ levelData })
  } catch (error: unknown) {
    console.error('Level generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
