'use client';

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUpRight, BookOpen, Bot, Check, ChevronDown, CircleHelp, FileText, FileUp, Gauge, Layers3, LoaderCircle, MessageSquare, Plus, Search, Send, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { Chunk, DocumentRecord, loadWorkspace, saveWorkspace } from '@/lib/storage';

type Message = { id: string; role: 'assistant' | 'user'; content: string; sources?: Array<{ id: string; label: string; documentName: string; page?: number; excerpt: string; score: number }> };
type Status = 'idle' | 'extracting' | 'indexing' | 'answering';
const starterQuestions = ['Summarize the key findings', 'What are the main risks?', 'List important dates and numbers'];
function splitIntoChunks(text: string, documentId: string, documentName: string, page?: number): Chunk[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const size = 1050, overlap = 180, chunks: Chunk[] = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const part = clean.slice(start, start + size).trim();
    if (part.length > 40) chunks.push({ id: documentId + '-' + chunks.length, documentId, documentName, text: part, page });
    if (start + size >= clean.length) break;
  }
  return chunks;
}
async function extractFile(file: File): Promise<Array<{ text: string; page?: number }>> {
  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.md')) return [{ text: await file.text() }];
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + pdfjs.version + '/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: Array<{ text: string; page: number }> = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      if (text.trim()) pages.push({ text, page: pageNum });
    }
    return pages;
  }
  throw new Error('Please upload a PDF, TXT, or Markdown file.');
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

export default function Home() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [messages, setMessages] = useState<Message[]>([{ id: 'welcome', role: 'assistant', content: 'Welcome to Context. Upload your documents and ask a question. I’ll search across your files and keep answers grounded in the source material.' }]);
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadWorkspace().then((data) => { if (data) { setDocuments(data.documents); setChunks(data.chunks); } }).catch(() => {}).finally(() => setReady(true)); }, []);
  useEffect(() => { if (ready) saveWorkspace({ documents, chunks }).catch(() => {}); }, [documents, chunks, ready]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, status]);

  async function processFiles(fileList: FileList | File[]) {
    setError('');
    const accepted = Array.from(fileList).filter((f) => /\.(pdf|txt|md)$/i.test(f.name));
    if (!accepted.length) { setError('Choose a PDF, TXT, or Markdown file.'); return; }
    for (const file of accepted) {
      if (file.size > 15 * 1024 * 1024) { setError(file.name + ' is larger than 15 MB.'); continue; }
      setStatus('extracting');
      try {
        const id = uid();
        const pages = await extractFile(file);
        const newChunks = pages.flatMap((page) => splitIntoChunks(page.text, id, file.name, page.page));
        if (!newChunks.length) { setError(file.name + ' contains no extractable text. Scanned PDFs need OCR before upload.'); continue; }
        setStatus('indexing');
        const response = await fetch('/api/rag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'index', chunks: newChunks.map(({ id, documentId, documentName, text, page }) => ({ id, documentId, documentName, text, page })) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not index this document.');
        const indexed = newChunks.map((chunk, i) => ({ ...chunk, embedding: data.embeddings[i] as number[] }));
        setChunks((prev) => [...prev.filter((c) => c.documentId !== id), ...indexed]);
        setDocuments((prev) => [...prev, { id, name: file.name, type: file.name.split('.').pop()?.toUpperCase() || 'FILE', size: file.size, chunks: indexed.length, addedAt: Date.now() }]);
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not process ' + file.name); }
    }
    setStatus('idle');
  }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void processFiles(event.dataTransfer.files); }
  function onChoose(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) void processFiles(event.target.files); event.target.value = ''; }
  function removeDocument(id: string) { setDocuments((prev) => prev.filter((d) => d.id !== id)); setChunks((prev) => prev.filter((c) => c.documentId !== id)); }
  async function ask(text?: string) {
    const prompt = (text ?? question).trim();
    if (!prompt || status !== 'idle') return;
    if (!chunks.length) { setError('Upload and index a document before asking a question.'); return; }
    setError(''); setQuestion('');
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: prompt }]);
    setStatus('answering');
    try {
      const response = await fetch('/api/rag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ask', question: prompt, chunks }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not answer this question.');
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: data.answer, sources: data.sources }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setStatus('idle'); }
  }
  function onSubmit(e: FormEvent) { e.preventDefault(); void ask(); }
  const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);
  const sizeLabel = totalSize > 1024 * 1024 ? (totalSize / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(totalSize / 1024)) + ' KB';

  return <main className="shell">
    <aside className="sidebar">
      <a className="brand" href="#top"><span className="brand-mark"><Layers3 size={19}/></span><span>context<span className="brand-dot">.</span><small>RESEARCH WORKSPACE</small></span></a>
      <div className="workspace-label">WORKSPACE <ChevronDown size={13}/></div>
      <button className="nav-item active"><MessageSquare size={16}/> Document chat <span className="nav-count">{documents.length}</span></button>
      <div className="side-section"><span>YOUR LIBRARY</span><button className="icon-button small" title="Add documents" onClick={() => fileInput.current?.click()}><Plus size={15}/></button></div>
      <div className="document-list">
        {documents.map((doc) => <div className="document-row" key={doc.id}><span className="file-icon"><FileText size={16}/></span><div className="doc-copy"><strong title={doc.name}>{doc.name}</strong><small>{doc.chunks} chunks · {doc.type}</small></div><button className="remove-button" title={'Remove ' + doc.name} onClick={() => removeDocument(doc.id)}><X size={14}/></button></div>)}
        {!documents.length && <div className="empty-library">Your documents will appear here after upload.</div>}
      </div>
      <button className="upload-side" onClick={() => fileInput.current?.click()}><Plus size={16}/> Add documents</button>
      <div className="sidebar-bottom"><div className="privacy-icon"><ShieldCheck size={17}/></div><div><strong>Private by design</strong><p>Your indexed files stay in this browser. Text is sent to your configured AI provider to answer questions.</p></div></div>
    </aside>

    <section className="main-panel" id="top">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>Document chat</strong></div><div className="top-actions"><span className="status-pill"><span className="status-dot"/> {chunks.length ? 'Index ready' : 'Awaiting documents'}</span><button className="icon-button" title="About Context" onClick={() => setError('Context uses hybrid semantic + BM25 retrieval. Add OPENAI_API_KEY in Vercel environment variables to enable indexing and answers.')}><CircleHelp size={17}/></button></div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><div className="eyebrow"><Sparkles size={13}/> YOUR AI RESEARCH ASSISTANT</div><h1>Ask your documents<span>.</span></h1><p>Find the signal in your files. Get grounded answers with traceable sources.</p></div><div className="heading-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><BookOpen size={25}/></div><span className="art-spark spark-a">✳</span><span className="art-spark spark-b">✧</span></div></div>
        <div className="metrics-row"><div className="metric-card"><span className="metric-icon"><FileText size={16}/></span><div><strong>{documents.length}</strong><span>Documents</span></div></div><div className="metric-card"><span className="metric-icon violet"><Layers3 size={16}/></span><div><strong>{chunks.length}</strong><span>Indexed chunks</span></div></div><div className="metric-card"><span className="metric-icon green"><Gauge size={16}/></span><div><strong>{chunks.length ? 'Hybrid' : '—'}</strong><span>Retrieval mode</span></div></div><div className="metric-card"><span className="metric-icon amber"><Activity size={16}/></span><div><strong>{documents.length ? sizeLabel : '0 KB'}</strong><span>Library size</span></div></div></div>
        <div className="work-grid">
          <section className="chat-card"><div className="card-heading"><div className="heading-icon"><Bot size={18}/></div><div><h2>Document conversation</h2><p>Answers grounded in your uploaded files</p></div><span className="live-label"><span/> LIVE</span></div>
            <div className="chat-scroll"><div className="conversation-date">TODAY · NEW SESSION</div>
              {messages.map((message) => <div className={'message-row ' + message.role} key={message.id}><div className={'avatar ' + message.role}>{message.role === 'assistant' ? <Sparkles size={15}/> : 'Y'}</div><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Context AI' : 'You'}</strong><span>{message.role === 'assistant' ? 'Grounded response' : 'Question'}</span></div><div className="message-content">{message.content.split(/(\[[^\]]+\])/g).map((part, i) => /^\[[^\]]+\]$/.test(part) ? <span className="inline-citation" key={i}>{part}</span> : <span key={i}>{part}</span>)}</div>
                {message.sources && message.sources.length > 0 && <div className="sources-block"><div className="sources-title"><BookOpen size={13}/> SOURCES USED <span>{message.sources.length}</span></div><div className="source-list">{message.sources.map((source, i) => <details className="source-item" key={source.id}><summary><span className="source-number">{i + 1}</span><span className="source-name">{source.documentName}{source.page ? ' · p. ' + source.page : ''}</span><span className="source-score">{Math.round(source.score * 100)}%</span><ChevronDown size={14}/></summary><p>{source.excerpt}{source.excerpt.length >= 360 ? '…' : ''}</p></details>)}</div></div>}
              </div></div>)}
              {status === 'answering' && <div className="message-row assistant"><div className="avatar assistant"><Sparkles size={15}/></div><div className="message-body"><div className="message-meta"><strong>Context AI</strong><span>Searching your library</span></div><div className="thinking"><span/><span/><span/> <em>Retrieving passages and composing answer…</em></div></div></div>}
              <div ref={bottomRef}/>
            </div>
            {!documents.length && <div className="suggestion-area"><p>TRY ASKING</p><div className="suggestions">{starterQuestions.map((s) => <button key={s} onClick={() => setError('Upload a document first, then ask: ' + s)}>{s}<ArrowUpRight size={13}/></button>)}</div></div>}
            <form className="composer" onSubmit={onSubmit}><div className="composer-tools"><span className="context-indicator"><span/> {chunks.length ? documents.length + ' source file' + (documents.length === 1 ? '' : 's') + ' connected' : 'No source files connected'}</span><span className="shortcut">ENTER ↵</span></div><div className="composer-input"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={chunks.length ? 'Ask anything about your documents…' : 'Upload a document to start asking questions'} rows={2} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}/><button type="submit" className="send-button" disabled={!question.trim() || status !== 'idle' || !chunks.length} aria-label="Send question">{status === 'answering' ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>}</button></div><div className="composer-foot"><span><ShieldCheck size={12}/> Answers include source references</span><span>Shift + Enter for new line</span></div></form>
          </section>
          <aside className="right-column"><section className="upload-card"><div className="card-heading compact"><div className="heading-icon upload-icon"><FileUp size={18}/></div><div><h2>Knowledge base</h2><p>Manage your source material</p></div></div><div className={'drop-zone ' + (dragging ? 'dragging' : '')} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><div className="drop-icon"><FileUp size={21}/></div><strong>Drop files to upload</strong><span>or <button onClick={() => fileInput.current?.click()}>browse files</button></span><small>PDF, TXT, MD · Up to 15 MB each</small></div><input ref={fileInput} className="hidden-input" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" multiple onChange={onChoose}/>
            {status !== 'idle' && <div className="progress-row"><LoaderCircle size={14} className="spin"/><span>{status === 'extracting' ? 'Extracting document text…' : status === 'indexing' ? 'Creating semantic embeddings…' : 'Retrieving relevant passages…'}</span></div>}
            {documents.length > 0 && <div className="library-summary"><div className="summary-top"><span>INDEXED LIBRARY</span><span>{documents.length} FILE{documents.length === 1 ? '' : 'S'}</span></div>{documents.slice(-3).reverse().map((doc) => <div className="mini-file" key={doc.id}><span className="mini-file-icon"><FileText size={15}/></span><div><strong>{doc.name}</strong><small>{doc.chunks} chunks · {(doc.size / 1024).toFixed(0)} KB</small></div><Check size={14} className="check-icon"/></div>)}{documents.length > 3 && <p className="more-files">+ {documents.length - 3} more in your library</p>}</div>}
          </section>
          <section className="pipeline-card"><div className="pipeline-title"><span className="pipeline-symbol"><Activity size={16}/></span><div><h3>Retrieval pipeline</h3><p>How Context finds answers</p></div></div><div className="pipeline-steps"><div className="pipeline-step"><span className="step-number">01</span><div><strong>Semantic search</strong><p>Embedding similarity with OpenAI</p></div><span className={'step-state ' + (chunks.length ? 'complete' : '')}>{chunks.length ? <Check size={12}/> : '—'}</span></div><div className="pipeline-connector"/><div className="pipeline-step"><span className="step-number">02</span><div><strong>Keyword search</strong><p>BM25 term relevance scoring</p></div><span className={'step-state ' + (chunks.length ? 'complete' : '')}>{chunks.length ? <Check size={12}/> : '—'}</span></div><div className="pipeline-connector"/><div className="pipeline-step"><span className="step-number">03</span><div><strong>Hybrid retrieval</strong><p>Rank and combine top passages</p></div><span className={'step-state ' + (chunks.length ? 'complete' : '')}>{chunks.length ? <Check size={12}/> : '—'}</span></div><div className="pipeline-connector"/><div className="pipeline-step"><span className="step-number">04</span><div><strong>Grounded generation</strong><p>Responses with source citations</p></div><span className={'step-state ' + (chunks.length ? 'complete' : '')}>{chunks.length ? <Check size={12}/> : '—'}</span></div></div></section>
          <section className="tip-card"><div className="tip-icon"><Sparkles size={16}/></div><div><strong>Get better answers</strong><p>Ask specific questions, compare findings across files, or request summaries with key evidence.</p></div><ArrowDown size={14}/></section>
        </aside></div>
        {error && <div className="toast" role="status"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={15}/></button></div>}
        <footer className="page-footer"><span>CONTEXT <b>·</b> DOCUMENT INTELLIGENCE</span><span>Built for grounded research <span className="footer-heart">✳</span></span><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API setup <ArrowUpRight size={12}/></a></footer>
      </div>
    </section>
  </main>;
}
