import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { theme, perspective, referenceImageBase64 } = await req.json()

    const falKey = process.env.FAL_KEY
    if (!falKey) {
      return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
    }

    // Build the prompt
    const perspectiveStyle = perspective === 'platformer'
      ? 'side-scrolling 2D game background, horizontal layers'
      : 'top-down 2D game map view, birds eye perspective'

    const prompt = `${perspectiveStyle}, ${theme}, game level art, detailed textures, atmospheric lighting, professional game concept art, no UI, no text, no characters, seamlessly tileable environment`

    const falEndpoint = referenceImageBase64
      ? 'https://fal.run/fal-ai/flux/dev/image-to-image'
      : 'https://fal.run/fal-ai/flux/dev'

    const body = referenceImageBase64
      ? {
          prompt,
          image_url: `data:image/jpeg;base64,${referenceImageBase64}`,
          strength: 0.75,
          num_inference_steps: 28,
          guidance_scale: 3.5,
          image_size: { width: 1024, height: 1024 },
          num_images: 1,
        }
      : {
          prompt,
          num_inference_steps: 28,
          guidance_scale: 3.5,
          image_size: { width: 1024, height: 1024 },
          num_images: 1,
          enable_safety_checker: true,
        }

    // Call fal.ai REST API directly
    const falRes = await fetch(falEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!falRes.ok) {
      const err = await falRes.text()
      console.error('fal.ai error:', err)
      return NextResponse.json({ error: `fal.ai error: ${falRes.status}` }, { status: 500 })
    }

    const result = await falRes.json()
    const imageUrl = result.images?.[0]?.url

    if (!imageUrl) {
      return NextResponse.json({ error: 'No image returned from fal.ai' }, { status: 500 })
    }

    return NextResponse.json({ imageUrl })
  } catch (error: unknown) {
    console.error('Map generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
