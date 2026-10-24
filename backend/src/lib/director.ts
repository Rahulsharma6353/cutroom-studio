import Anthropic from '@anthropic-ai/sdk';
import { validateOps } from '@shared/ops';
import type { DirectorRequest, DirectorResponse, EditOp } from '@shared/types';

// Server-only. The model id lives in env and never reaches the browser or the response body.
const MODEL = process.env.DIRECTOR_MODEL || 'claude-opus-5-5';

const SYSTEM = `You are the editor inside a short-form video editing app. You plan edits; you never render pixels.
Rules:
- You may only change the time range given as "selection". If selection is null, the whole video is in scope.
- Express every change as operations in the propose_edit tool. Times are in seconds on the timeline as it is now, before any of your ops; the app shifts inserts through your cuts.
- Removing pauses: one ripple_delete per pause inside the range, keeping ~0.06 s of breath at each side.
- Removing filler words: ripple_delete from the filler word's start to just before the next word.
- B-roll: insert_clip on trackKind "broll", origin "stock", job {type:"stock"}, one clip per ~3 s, label = a concrete search query.
- Generated images: trackKind "overlay", assetKind "image", origin "generated", job {type:"image", eta:5}. Label = a vivid, specific image prompt that matches the script line and the video's aspect ratio. Never depict a real, named person.
- Generated video: trackKind "broll", origin "generated", job {type:"video", eta:9}, duration 3–8 s.
- Screen recordings: trackKind "broll", assetKind "screen", origin "recorded", job {type:"screen", eta:6}, label "Screen: <domain>". Public pages only.
- A named real person or news event needs a licensed photo or clip: use origin "stock", never "generated".
- Graphics (trackKind "overlay", assetKind "graphic", origin "library"): BigWord = one giant word at the moment it is spoken, sub = the 1–2 words before it, slide=true covers the speaker; List = 2–4 short rows (items), slide=true, about 1.4 s per row.
- UI cards (component "UI") sit beside the speaker: ui=profile (value = follower count, strike=true to cross it out), videos (items = view counts), notify (items = toast lines), chart. Use them when the script talks about followers, views, reach or growth.
- SFX labels must be one of: Whoosh, Pop, Type, Ding, Riser, Hit, Click.
- Sound: sfx clips 0.4–1.6 s on cuts; music on trackKind "music" with job {type:"music", eta:2}.
- reply: one or two plain sentences to the creator, no model or tool names. summary: a short past-tense line, e.g. "Removed 3 pauses, added 2 B-roll shots".`;

const opSchema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['insert_clip', 'ripple_delete', 'set_zoom', 'set_caption_preset', 'set_captions_enabled'] },
    start: { type: 'number' },
    end: { type: 'number' },
    duration: { type: 'number' },
    trackKind: { type: 'string', enum: ['overlay', 'broll', 'aroll', 'sfx', 'music'] },
    label: { type: 'string' },
    assetKind: { type: 'string', enum: ['broll', 'image', 'graphic', 'screen', 'sfx', 'music'] },
    origin: { type: 'string', enum: ['stock', 'generated', 'recorded', 'library'] },
    job: { type: 'object', properties: { type: { type: 'string', enum: ['image', 'video', 'screen', 'stock', 'music'] }, eta: { type: 'number' } }, required: ['type', 'eta'] },
    graphic: { type: 'object', properties: { component: { type: 'string', enum: ['LowerThird', 'Headline', 'Counter', 'Callout', 'BigWord', 'List', 'UI'] }, ui: { type: 'string', enum: ['profile', 'videos', 'notify', 'chart'] }, value: { type: 'string' }, strike: { type: 'boolean' }, text: { type: 'string' }, sub: { type: 'string' }, items: { type: 'array', items: { type: 'string' } }, color: { type: 'string' }, slide: { type: 'boolean' } }, required: ['component', 'text'] },
    zoom: { type: 'number' },
    presetId: { type: 'string', enum: ['bold-pop', 'karaoke', 'minimal', 'boxed', 'hindi', 'ticker', 'editorial', 'pixel', 'reveal-red', 'story-box', 'red-label', 'cropped-bold'] },
    enabled: { type: 'boolean' },
    credit: { type: 'string' },
  },
  required: ['op'],
} as const;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

export async function direct(req: DirectorRequest): Promise<DirectorResponse> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [
      {
        name: 'propose_edit',
        description: 'Submit the edit plan as timeline operations plus a short reply for the creator.',
        input_schema: {
          type: 'object',
          properties: {
            reply: { type: 'string' },
            summary: { type: 'string' },
            ops: { type: 'array', items: opSchema },
          },
          required: ['reply', 'summary', 'ops'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'propose_edit' },
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          request: req.prompt,
          selection: req.selection,
          videoDuration: req.duration,
          aspectRatio: req.context.aspect,
          transcript: req.context.words,
          pauses: req.context.pauses,
          clips: req.context.clips,
        }),
      },
    ],
  });

  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('no plan');
  const plan = block.input as DirectorResponse;
  return {
    reply: String(plan.reply ?? ''),
    summary: String(plan.summary ?? ''),
    ops: validateOps((plan.ops ?? []) as EditOp[], req.selection, req.duration),
  };
}
