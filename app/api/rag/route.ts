import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
type InputChunk = { id: string; documentId: string; documentName: string; text: string; page?: number; embedding?: number[] };
const apiKey = () => process.env.OPENAI_API_KEY;
const embeddingModel = () => process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const chatModel = () => process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

async function openai(path: string, body: unknown) {
  const key = apiKey();
  if (!key) throw new Error('OPENAI_API_KEY is missing. Add it in Vercel → Project Settings → Environment Variables.');
  const response = await fetch('https://api.openai.com/v1/' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'AI provider request failed (' + response.status + ')');
  return data;
}
async function embed(texts: string[]): Promise<number[][]> {
  const output: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const result = await openai('embeddings', { model: embeddingModel(), input: batch });
    const rows = (result.data as Array<{ index: number; embedding: number[] }>).sort((a,b) => a.index - b.index);
    output.push(...rows.map((row) => row.embedding));
  }
  return output;
}
function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
}
function cosine(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}
function bm25(query: string, docs: InputChunk[]): Map<string, number> {
  const q = [...new Set(tokens(query))];
  const corpus = docs.map((d) => tokens(d.text));
  const avg = corpus.reduce((s, d) => s + d.length, 0) / Math.max(corpus.length, 1);
  const df = new Map<string, number>();
  for (const term of q) df.set(term, corpus.reduce((n, d) => n + (d.includes(term) ? 1 : 0), 0));
  const raw = corpus.map((doc) => {
    const counts = new Map<string, number>(); for (const term of doc) counts.set(term, (counts.get(term) || 0) + 1);
    let score = 0;
    for (const term of q) { const tf = counts.get(term) || 0; if (!tf) continue; const idf = Math.log(1 + (docs.length - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5)); score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * doc.length / Math.max(avg, 1))); }
    return score;
  });
  const max = Math.max(...raw, 0.00001);
  return new Map(docs.map((d, i) => [d.id, raw[i] / max]));
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    if (payload.action === 'index') {
      const chunks = payload.chunks as InputChunk[];
      if (!Array.isArray(chunks) || chunks.length === 0) return NextResponse.json({ error: 'No readable document text was found.' }, { status: 400 });
      if (chunks.length > 500) return NextResponse.json({ error: 'This workspace supports up to 500 text chunks at a time. Upload fewer or shorter documents.' }, { status: 413 });
      const vectors = await embed(chunks.map((c) => c.text));
      return NextResponse.json({ embeddings: vectors, model: embeddingModel(), indexedChunks: chunks.length });
    }
    if (payload.action === 'ask') {
      const question = String(payload.question || '').trim();
      const chunks = payload.chunks as InputChunk[];
      if (!question) return NextResponse.json({ error: 'Enter a question first.' }, { status: 400 });
      if (!Array.isArray(chunks) || !chunks.length || chunks.some((c) => !Array.isArray(c.embedding))) return NextResponse.json({ error: 'Upload and index at least one document first.' }, { status: 400 });
      const [queryVector] = await embed([question]);
      const lexical = bm25(question, chunks);
      const ranked = chunks.map((chunk) => ({ chunk, semantic: (cosine(queryVector, chunk.embedding || []) + 1) / 2, keyword: lexical.get(chunk.id) || 0 }))
        .map((item) => ({ ...item, score: item.semantic * 0.65 + item.keyword * 0.35 }))
        .sort((a, b) => b.score - a.score).slice(0, 7);
      const sources = ranked.filter((r) => r.score > 0.03).map((r, i) => ({ id: r.chunk.id, label: '[' + (i + 1) + '] ' + r.chunk.documentName, documentName: r.chunk.documentName, page: r.chunk.page, excerpt: r.chunk.text.slice(0, 360), score: Number(r.score.toFixed(3)), text: r.chunk.text }));
      if (!sources.length) return NextResponse.json({ answer: 'I could not find a relevant passage in the uploaded documents. Try asking with terms used in the source material.', sources: [] });
      const context = sources.map((s) => '[' + s.id + '] Source: ' + s.documentName + (s.page ? ', page ' + s.page : '') + '\n' + s.text).join('\n\n---\n\n');
      const result = await openai('chat/completions', {
        model: chatModel(), temperature: 0.1,
        messages: [
          { role: 'system', content: 'You are Context, a document-grounded research assistant. Answer only from the supplied context. Cite claims with the exact source IDs in square brackets, such as [chunk-id]. If the context does not contain the answer, say so plainly. Distinguish facts from reasonable inference. Never invent a quote, page number, or source. Be concise but useful.' },
          { role: 'user', content: 'Question: ' + question + '\n\nRetrieved context:\n' + context + '\n\nAnswer using source citations.' },
        ],
      });
      const answer = result.choices?.[0]?.message?.content || 'I could not generate an answer for this question.';
      return NextResponse.json({ answer, sources: sources.map(({ text: _text, ...source }) => source), retrieval: 'hybrid', model: chatModel() });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
