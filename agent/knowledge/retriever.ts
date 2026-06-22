/**
 * Blender API RAG Retriever
 * =========================
 * Retrieves relevant Blender API documentation chunks for a given query.
 * Used by the GPT code-generation agent to ground bpy code in actual docs.
 *
 * Supports two modes:
 * 1. Embedding-based (cosine similarity) — requires embeddings to have been generated
 * 2. Keyword-based (TF-IDF-like scoring) — always available as fallback
 */

import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import type { DocChunk } from "./ingest_docs.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const INDEX_DIR = path.resolve(import.meta.dirname || ".", "./bpy_api_index");

// ---------------------------------------------------------------------------
// Index Loading
// ---------------------------------------------------------------------------

interface IndexData {
  chunks: Omit<DocChunk, "embedding">[];
  embeddings: Map<string, number[]>;
  loaded: boolean;
}

let _index: IndexData | null = null;

function loadIndex(): IndexData {
  if (_index) return _index;

  const chunksFile = path.join(INDEX_DIR, "chunks.json");
  const embeddingsFile = path.join(INDEX_DIR, "embeddings.json");

  if (!fs.existsSync(chunksFile)) {
    console.warn(`[RAG] Index not found at ${INDEX_DIR}. Run ingest_docs.ts first.`);
    _index = { chunks: [], embeddings: new Map(), loaded: false };
    return _index;
  }

  const chunks = JSON.parse(fs.readFileSync(chunksFile, "utf-8")) as Omit<DocChunk, "embedding">[];
  const embeddings = new Map<string, number[]>();

  if (fs.existsSync(embeddingsFile)) {
    const embData = JSON.parse(fs.readFileSync(embeddingsFile, "utf-8")) as {
      id: string;
      embedding: number[];
    }[];
    for (const item of embData) {
      if (item.embedding && item.embedding.length > 0) {
        embeddings.set(item.id, item.embedding);
      }
    }
  }

  console.log(
    `[RAG] Loaded index: ${chunks.length} chunks, ${embeddings.size} with embeddings`
  );

  _index = { chunks, embeddings, loaded: true };
  return _index;
}

// ---------------------------------------------------------------------------
// Similarity Functions
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

function keywordScore(query: string, text: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const textLower = text.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    // Count occurrences
    let idx = 0;
    let count = 0;
    while ((idx = textLower.indexOf(term, idx)) !== -1) {
      count++;
      idx += term.length;
    }
    score += count;

    // Bonus for exact bpy API matches
    if (term.startsWith("bpy.") || term.includes(".ops.") || term.includes(".types.")) {
      score += count * 3;
    }
  }

  // Bonus for code blocks
  if (textLower.includes("```") || textLower.includes("import bpy")) {
    score += 2;
  }

  // Bonus for API module relevance
  for (const term of queryTerms) {
    if (textLower.includes(`bpy.ops.${term}`) || textLower.includes(`bpy.types.${term}`)) {
      score += 5;
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RetrievalResult {
  chunk: Omit<DocChunk, "embedding">;
  score: number;
  method: "embedding" | "keyword";
}

/**
 * Retrieve the most relevant Blender API doc chunks for a given query.
 *
 * @param query - Natural language description of what bpy code should do
 * @param topK - Number of results to return (default: 8)
 * @param apiModuleFilter - Optional: filter to specific bpy module (e.g., "bpy.ops.armature")
 * @returns Ranked list of relevant doc chunks
 */
export async function retrieveBlenderContext(
  query: string,
  topK: number = 8,
  apiModuleFilter?: string
): Promise<RetrievalResult[]> {
  const index = loadIndex();

  if (!index.loaded || index.chunks.length === 0) {
    console.warn("[RAG] No index available. Returning empty context.");
    return [];
  }

  let candidates = index.chunks;

  // Apply module filter if specified
  if (apiModuleFilter) {
    const filtered = candidates.filter(
      (c) => c.api_module === apiModuleFilter || c.api_module === "general"
    );
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }

  // Try embedding-based retrieval first
  if (index.embeddings.size > candidates.length * 0.5) {
    try {
      const results = await embeddingSearch(query, candidates, index.embeddings, topK);
      if (results.length > 0) {
        return results;
      }
    } catch (err) {
      console.warn("[RAG] Embedding search failed, falling back to keyword:", err);
    }
  }

  // Fallback: keyword-based retrieval
  return keywordSearch(query, candidates, topK);
}

async function embeddingSearch(
  query: string,
  candidates: Omit<DocChunk, "embedding">[],
  embeddings: Map<string, number[]>,
  topK: number
): Promise<RetrievalResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No GEMINI_API_KEY for embedding query");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.embedContent({
    model: "text-embedding-004",
    contents: query,
  });

  const queryEmbedding = (response as any).embedding?.values || (response as any).embedding;
  if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
    throw new Error("Failed to get query embedding");
  }

  const scored: RetrievalResult[] = [];
  for (const chunk of candidates) {
    const emb = embeddings.get(chunk.id);
    if (!emb) continue;
    const score = cosineSimilarity(queryEmbedding, emb);
    scored.push({ chunk, score, method: "embedding" });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function keywordSearch(
  query: string,
  candidates: Omit<DocChunk, "embedding">[],
  topK: number
): RetrievalResult[] {
  const scored: RetrievalResult[] = [];
  for (const chunk of candidates) {
    const score = keywordScore(query, chunk.text);
    if (score > 0) {
      scored.push({ chunk, score, method: "keyword" });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Format retrieved chunks into a context string suitable for LLM prompts.
 */
export function formatContextForPrompt(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return "No relevant Blender API documentation found.";
  }

  const sections = results.map((r, i) => {
    return [
      `--- Doc ${i + 1} [${r.chunk.api_module}] (${r.chunk.section_path}) ---`,
      r.chunk.text,
    ].join("\n");
  });

  return [
    "=== Relevant Blender 5.1 API Documentation ===",
    "",
    ...sections,
    "",
    "=== End Documentation ===",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CLI Entry Point (for testing retrieval)
// ---------------------------------------------------------------------------

async function main() {
  const queryIdx = process.argv.indexOf("--query");
  const query = queryIdx !== -1 ? process.argv[queryIdx + 1] : "create armature bones";

  console.log(`[RAG] Query: "${query}"`);
  console.log();

  const results = await retrieveBlenderContext(query, 5);

  for (const r of results) {
    console.log(
      `[${r.method}] Score: ${r.score.toFixed(4)} | Module: ${r.chunk.api_module} | Section: ${r.chunk.section_path}`
    );
    console.log(`  ${r.chunk.text.slice(0, 200)}...`);
    console.log();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
