import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'GameForge',
  description: 'Build games with AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#000' }}>{children}</body>
    </html>
  )
}
