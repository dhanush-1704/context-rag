# Context — Hybrid RAG Workspace

A Vercel-ready document Q&A app inspired by the Multi-Modal RAG & Agentic AI project: upload PDF/TXT/Markdown files, split text into overlapping chunks, create embeddings, retrieve passages with semantic similarity + BM25, and generate answers with source references.

## Features

- Dark research-workspace UI with document library, chat, retrieval pipeline status, and expandable source excerpts.
- PDF text extraction in the browser (text-based PDFs; scanned PDFs require OCR first).
- Chunking with overlap and OpenAI embeddings (`text-embedding-3-small` by default).
- Hybrid retrieval: cosine similarity + BM25 lexical scoring, weighted 65/35.
- Grounded answer generation using `gpt-4o-mini` by default; answers are instructed to cite source chunk IDs.
- Indexed chunks are stored in the browser's IndexedDB and remain available in that browser profile.
- API key stays server-side in the Next.js route; it is never sent to the browser.

## Deploy on Vercel

1. Import `https://github.com/dhanush-1704/context-rag` into Vercel.
2. Keep the default branch (`main`).
3. Leave **Root Directory** set to the repository root.
4. Add `OPENAI_API_KEY` in Project Settings → Environment Variables. Optionally set `OPENAI_CHAT_MODEL` and `OPENAI_EMBEDDING_MODEL`.
5. Deploy.

## Run locally

```bash
npm install
cp .env.example .env.local
# Put your key in .env.local
npm run dev
```

Open `http://localhost:3000`.

## API

`POST /api/rag` with `action: "index"` creates chunk embeddings. `action: "ask"` embeds the question, performs hybrid retrieval, and generates an answer grounded in retrieved passages.

## Architecture notes

This Vercel-native implementation uses OpenAI embeddings and browser-side IndexedDB so it can run without a long-lived server. It reproduces the key retrieval concepts of the original project, but it does **not** run the original Python `sentence-transformers` + FAISS stack or a cross-encoder reranker. For a production multi-user deployment, use authenticated server-side document storage and a managed vector database or a persistent Python/FastAPI service; browser-local documents are per browser and are not shared across users or devices.

## Limits and privacy

- Up to 500 chunks per indexing request; individual files up to 15 MB.
- The configured OpenAI API receives document text during embedding and retrieved passages during answer generation.
- Never commit `.env.local` or an API key. Set the key as a Vercel environment variable.
