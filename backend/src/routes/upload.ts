import { saveUpload } from '../lib/storage';
import type { AssetKind } from '@shared/types';


const KINDS: AssetKind[] = ['aroll', 'broll', 'image', 'graphic', 'screen', 'sfx', 'music', 'script'];
const MAX_BYTES = 10 * 1024 ** 3; // 10 GB

/** Raw-body upload: the browser streams the file as the request body (no multipart parsing). */
export async function POST(request: Request) {
  const name = decodeURIComponent(request.headers.get('x-file-name') ?? '').slice(0, 200);
  const kind = request.headers.get('x-file-kind') as AssetKind;
  const mime = request.headers.get('content-type') ?? 'application/octet-stream';
  if (!name || !request.body) return Response.json({ error: 'Choose a file to upload.' }, { status: 400 });
  if (!KINDS.includes(kind)) return Response.json({ error: 'Unknown file type.' }, { status: 400 });

  const ext = (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'bin').toLowerCase();
  try {
    const meta = await saveUpload(request.body, { name, kind, mime, ext }, MAX_BYTES);
    return Response.json({ id: meta.id, url: `/api/media/${meta.id}`, name, size: meta.size, kind });
  } catch (err) {
    const tooBig = err instanceof Error && err.message === 'too large';
    return Response.json({ error: tooBig ? 'That file is over 10 GB. Trim it or upload a shorter take.' : 'The upload stopped before it finished. Check your connection and try again.' }, { status: tooBig ? 413 : 500 });
  }
}
