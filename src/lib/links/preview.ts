const URL_PATTERN = /https?:\/\/[^\s<>()]+/i

export interface OpenGraphData {
  title?: string
  description?: string
  image?: string
}

export function extractFirstUrl(text: string | null | undefined): string | null {
  const match = (text ?? '').match(URL_PATTERN)
  return match ? match[0].replace(/[.,!?;:]+$/, '') : null
}

function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  const match = html.match(pattern)
  return (match?.[1] ?? match?.[2])?.trim() || undefined
}

export function parseOpenGraph(html: string): OpenGraphData {
  return {
    title: metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title'),
    description: metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description'),
    image: metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image'),
  }
}
