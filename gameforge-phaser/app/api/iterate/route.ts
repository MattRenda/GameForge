import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const ITERATE_SYSTEM = `You are a game director AI. A user wants to modify their game.
Analyze the request and output ONLY raw JSON — no markdown, no backticks, start with {.

Pick the changeType:
- "logic"  — only game data changes (speed, hp, enemy count, colors). No art regeneration.
- "art"    — visual/theme/style change. Regenerate fal.ai assets.
- "asset"  — change one specific asset only.
- "full"   — logic + art both change.

Output:
{
  "changeType": "logic",
  "reasoning": "only stats changed",
  "assetKey": null,
  "newTheme": null,
  "newStyle": null,
  "playerPatch": { "speed": null, "hp": null, "color": null, "size": null },
  "enemyPatches": [],
  "summary": "Made the player faster"
}

enemyPatches: [{"roomId":"boss","index":0,"hp":500,"speed":80,"color":null}]
Only set fields that actually change. Null = keep existing.`

export async function POST(req: NextRequest) {
  try {
    const { changeRequest, currentLevel, currentStyle, currentTheme } = await req.json()

    const ctx =
      `Request: "${changeRequest}"\n` +
      `Style: ${currentStyle||'pixel art'} | Theme: ${currentTheme||'dungeon'}\n` +
      `Rooms: ${(currentLevel?.rooms||[]).map((r:any)=>`${r.id}(${r.label},${r.enemies?.length||0} enemies)`).join(', ')}\n` +
      `Player: speed=${currentLevel?.player?.speed} hp=${currentLevel?.player?.hp} color=${currentLevel?.player?.color}`

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 350,
      system: ITERATE_SYSTEM,
      messages: [{ role: 'user', content: ctx }],
    })

    const raw = (msg.content[0] as { text: string }).text.trim()
      .replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/i,'').trim()

    const first = raw.indexOf('{'), last = raw.lastIndexOf('}')
    if (first === -1 || last <= first) {
      return NextResponse.json({ error: 'No JSON: ' + raw.slice(0,100) }, { status:500 })
    }

    const plan = JSON.parse(raw.slice(first, last+1))
    console.log('Iterate plan:', plan.changeType, '—', plan.summary)
    return NextResponse.json({ plan })

  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status:500 })
  }
}
