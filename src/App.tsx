import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'

type Fit = 'cover' | 'contain'
type Card = { id: number; url: string; note: string; date: string; fit: Fit; tilt: number }

// Polaroid 600 print, 300 DPI: 88x107 mm frame, 79x79 mm photo, 4.5 mm side/top border
const DPI = 300 / 25.4
const PX = (mm: number) => Math.round(mm * DPI)
const W = PX(88), H = PX(107), PHOTO = PX(79), BORDER = PX(4.5)
const MAX_SIDE = 1600 // downscale at add time; plenty for a 79 mm print at 300 DPI (933 px)
const GITHUB = 'https://github.com/astradial/memories'

let nextId = 1
const coarse = () => matchMedia('(pointer: coarse)').matches
const revokeLater = (url: string) => setTimeout(() => URL.revokeObjectURL(url), 1000)

// One-time downscale (EXIF-corrected), returns a JPEG blob URL; the original File is dropped.
async function shrink(file: File): Promise<string> {
  let src: ImageBitmap | HTMLImageElement
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const img = new Image()
    img.src = URL.createObjectURL(file)
    try {
      await img.decode()
    } finally {
      revokeLater(img.src)
    }
    src = img
  }
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height
  const s = Math.min(1, MAX_SIDE / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * s))
  canvas.height = Math.max(1, Math.round(sh * s))
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height)
  if ('close' in src) src.close()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
  if (!blob) throw new Error('undecodable')
  return URL.createObjectURL(blob)
}

async function renderPng(card: Card, frameColor: string): Promise<File> {
  const img = new Image()
  img.src = card.url
  await Promise.all([
    img.decode(),
    document.fonts.load('600 60px Caveat', card.note || ' '),
    document.fonts.load('500 36px Caveat', card.date || ' '),
  ])

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = frameColor
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  ctx.fillRect(BORDER, BORDER, PHOTO, PHOTO)

  // cover: scale so the shorter side fills; contain: scale so the longer side fits
  const scale = (card.fit === 'cover' ? Math.max : Math.min)(PHOTO / img.width, PHOTO / img.height)
  const dw = img.width * scale, dh = img.height * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(BORDER, BORDER, PHOTO, PHOTO)
  ctx.clip()
  ctx.drawImage(img, BORDER + (PHOTO - dw) / 2, BORDER + (PHOTO - dh) / 2, dw, dh)
  ctx.restore()

  const stripTop = BORDER + PHOTO
  const stripH = H - stripTop
  ctx.fillStyle = '#1f2937'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '600 60px Caveat'
  ctx.fillText(card.note, W / 2, stripTop + stripH * (card.date ? 0.4 : 0.5), W - 2 * BORDER)
  if (card.date) {
    ctx.font = '500 36px Caveat'
    ctx.fillStyle = '#6b7280'
    ctx.fillText(card.date, W / 2, stripTop + stripH * 0.72, W - 2 * BORDER)
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('canvas.toBlob failed')
  const name = (card.note.trim() || 'memory').replace(/[\\/:*?"<>|]+/g, '-')
  return new File([blob], `${name}.png`, { type: 'image/png' })
}

const canShareFiles =
  typeof navigator.canShare === 'function' &&
  navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })

type Outcome = 'ok' | 'activation' | 'unshareable'
async function share(files: File[], text: string): Promise<Outcome> {
  if (!navigator.canShare({ files })) return 'unshareable' // >10 files / too large
  try {
    await navigator.share({ files, title: 'Memories', text })
    return 'ok'
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'ok'
    if ((e as Error).name === 'NotAllowedError') return 'activation' // lost user activation; PNGs are cached now
    throw e
  }
}

function saveAs(files: File[]) {
  files.forEach((f, i) =>
    setTimeout(() => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(f)
      a.download = f.name
      a.click()
      revokeLater(a.href)
    }, i * 300),
  )
}

const STEPS = [
  ['📷', 'Upload', 'Pick photos from your phone or computer.'],
  ['✍️', 'Write a note', 'Add a handwritten caption and a date.'],
  ['⬇️', 'Download or print', 'Save true-size PNGs or print on A4.'],
]

const EXAMPLES: [string, string, string, number][] = [
  ['goa', 'Goa sunset', 'Dec 2025', -2],
  ['office', 'First office', 'Aug 2026', 1],
  ['ooty', 'Ooty trip', 'May 2026', 2],
]

const UNSUPPORTED = "That file type isn't supported here — export it as JPEG first."

export default function App() {
  const [cards, setCards] = useState<Card[]>([])
  const [frameColor, setFrameColor] = useState('#fdfdfb')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const dragDepth = useRef(0)
  const queue = useRef(Promise.resolve()) // serialises image processing

  const addFiles = (files: FileList | null) => {
    if (!files) return
    setHint('')
    for (const f of Array.from(files).filter((f) => f.type.startsWith('image/'))) {
      queue.current = queue.current.then(async () => {
        try {
          const url = await shrink(f)
          setCards((c) => [
            ...c,
            { id: nextId++, url, note: f.name.replace(/\.[^.]+$/, ''), date: '', fit: 'cover', tilt: Math.random() * 4 - 2 },
          ])
        } catch {
          setHint(UNSUPPORTED)
        }
      })
    }
  }

  const update = (id: number, patch: Partial<Card>) =>
    setCards((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const remove = (id: number) =>
    setCards((c) => {
      const gone = c.find((x) => x.id === id)
      if (gone) revokeLater(gone.url)
      return c.filter((x) => x.id !== id)
    })

  const hasCards = cards.length > 0
  useEffect(() => {
    if (!hasCards) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [hasCards])

  // PNG cache keyed by everything that affects the render; pre-rendered ~500ms after edits settle
  const pngs = useRef(new Map<number, { key: string; file: Promise<File> }>())
  const pngFor = (card: Card) => {
    const key = JSON.stringify([card.note, card.date, card.fit, frameColor])
    const hit = pngs.current.get(card.id)
    if (hit?.key === key) return hit.file
    const file = queue.current.then(() => renderPng(card, frameColor))
    queue.current = file.then(() => {}, () => {})
    const entry = { key, file }
    file.catch(() => pngs.current.get(card.id) === entry && pngs.current.delete(card.id))
    pngs.current.set(card.id, entry)
    return file
  }
  useEffect(() => {
    const alive = new Set(cards.map((c) => c.id))
    for (const id of pngs.current.keys()) if (!alive.has(id)) pngs.current.delete(id)
    const t = setTimeout(() => cards.forEach(pngFor), 500)
    return () => clearTimeout(t)
  })

  const withFiles = async (list: Card[], action: 'share' | 'download') => {
    setBusy(true)
    setHint('')
    try {
      const files = await Promise.all(list.map(pngFor))
      const text = list.map((c) => c.note.trim()).filter(Boolean).join(' · ')
      // iOS Safari anchor downloads are unreliable → share sheet ("Save Image") there
      const useShare = action === 'share' || (canShareFiles && coarse())
      const outcome = useShare ? await share(files, text) : 'unshareable'
      if (outcome === 'activation') {
        setHint(`Tap ${action === 'share' ? 'Share' : 'Download'} once more to open the share sheet.`)
      } else if (outcome === 'unshareable') {
        saveAs(files)
        if (action === 'share') setHint('Too many to share at once — downloading instead.')
        else if (files.length > 1) setHint('Your browser may ask to allow multiple downloads.')
      }
    } catch {
      setHint("Couldn't create the image, please try again.")
    } finally {
      setBusy(false)
    }
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (dragDepth.current++ === 0) setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    if (--dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const fileInput = (
    <input
      type="file"
      multiple
      accept="image/*"
      hidden
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        addFiles(e.target.files)
        e.target.value = ''
      }}
    />
  )

  return (
    <div
      className="page"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      {dragging && <div className="drop-overlay">Drop photos to add them</div>}

      <header className="top">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (cards.length) {
              e.preventDefault()
              scrollTo({ top: 0, behavior: 'smooth' })
            }
          }}
        >
          Memories
        </a>
        <span className="by">by AstraDial</span>
        <a className="btn star" href={GITHUB} target="_blank" rel="noopener noreferrer">
          ★ Star<span className="wide"> on GitHub</span>
        </a>
      </header>

      {!cards.length ? (
        <section className="hero">
          <h1>Turn your photos into instant-camera memories</h1>
          <p>True-size Polaroid prints with a handwritten note. Free, no sign-up.</p>
          <label className="btn primary big">Select photos{fileInput}</label>
          <p className="or">or drop photos here</p>
          <p className="privacy">Your photos never leave your device.</p>
          <div className="examples" aria-hidden>
            {EXAMPLES.map(([img, note, date, tilt]) => (
              <div key={img} className="card-wrap" style={{ '--tilt': `${tilt}deg` } as CSSProperties}>
                <div className="card">
                  <div className="photo"><img src={`/examples/${img}.svg`} alt="" /></div>
                  <div className="strip">
                    <span className="note">{note}</span>
                    <span className="date">{date}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <ol className="steps">
            {STEPS.map(([icon, title, text]) => (
              <li key={title}>
                <span className="icon" aria-hidden>{icon}</span>
                <b>{title}</b>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <main className="wall">
          {cards.map((card) => (
            <div key={card.id} className="card-wrap" style={{ '--tilt': `${card.tilt}deg` } as CSSProperties}>
              <div className="card" style={{ background: frameColor }}>
                <div className="photo">
                  <img
                    src={card.url}
                    alt=""
                    style={{ objectFit: card.fit }}
                    onError={() => {
                      remove(card.id)
                      setHint(UNSUPPORTED)
                    }}
                  />
                </div>
                <div className="strip">
                  <input
                    className="note"
                    value={card.note}
                    maxLength={32}
                    onChange={(e) => update(card.id, { note: e.target.value })}
                    placeholder="write a note"
                  />
                  <input
                    className="date"
                    value={card.date}
                    onChange={(e) => update(card.id, { date: e.target.value })}
                    placeholder="date (optional)"
                  />
                </div>
              </div>
              <div className="controls">
                <button onClick={() => update(card.id, { fit: card.fit === 'cover' ? 'contain' : 'cover' })}>
                  {card.fit === 'cover' ? 'Fit' : 'Fill'}
                </button>
                {canShareFiles && (
                  <button onClick={() => withFiles([card], 'share')} disabled={busy}>Share</button>
                )}
                <button onClick={() => withFiles([card], 'download')} disabled={busy}>Save</button>
                <button className="danger" aria-label="Remove" title="Remove" onClick={() => remove(card.id)}>✕</button>
              </div>
            </div>
          ))}
        </main>
      )}

      {hint && <div className="hint">{hint}</div>}

      <footer className="foot">
        <span className="privacy">Your photos never leave your device.</span>
        <span>
          Made with <span className="heart">♥</span> by <a href="https://astradial.com">AstraDial</a>
          {' · '}
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
        </span>
      </footer>

      {cards.length > 0 && (
        <div className="bar">
          <label className="btn">＋ Add{fileInput}</label>
          <label className="btn swatch" title="Frame color" aria-label="Frame color">
            <span className="dot" style={{ background: frameColor }} />
            <span className="wide">Frame</span>
            <input type="color" value={frameColor} onChange={(e) => setFrameColor(e.target.value)} />
          </label>
          {canShareFiles && (
            <button className="btn primary" onClick={() => withFiles(cards, 'share')} disabled={busy}>
              {busy ? 'Preparing…' : 'Share all'}
            </button>
          )}
          <button className={`btn ${canShareFiles ? '' : 'primary'}`} onClick={() => withFiles(cards, 'download')} disabled={busy}>
            {busy && !canShareFiles ? 'Preparing…' : 'Download all'}
          </button>
          <button className="btn print" onClick={() => window.print()}>Print</button>
        </div>
      )}
    </div>
  )
}
