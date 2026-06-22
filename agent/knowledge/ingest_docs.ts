/**
 * Blender API Docs Ingestion
 * ==========================
 * Processes the local Blender 5.1 manual HTML docs into a vector store
 * (LanceDB) for RAG-based code generation grounding.
 *
 * Usage: npx tsx agent/knowledge/ingest_docs.ts
 *
 * This reads from blender_manual_v510_en.html/ and creates a searchable
 * vector index in agent/knowledge/bpy_api_index/
 */

import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DOCS_DIR = path.resolve(import.meta.dirname || ".", "../../blender_manual_v510_en.html");
const INDEX_DIR = path.resolve(import.meta.dirname || ".", "./bpy_api_index");
const CHUNK_SIZE = 1500; // characters per chunk
const CHUNK_OVERLAP = 200;

// Sections most relevant for bpy code generation
const PRIORITY_PATHS = [
  "modeling",
  "animation",
  "render",
  "sculpt_paint",
  "physics",
  "scene_layout",
  "editors",
  "advanced",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocChunk {
  id: string;
  text: string;
  section_path: string;
  source_file: string;
  api_module: string;
  embedding?: number[];
}

// ---------------------------------------------------------------------------
// HTML Parsing (simple regex-based for static Sphinx docs)
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Remove navigation, header, footer sections
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  // Convert code blocks to text
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  // Convert headers
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    return "\n" + "#".repeat(parseInt(level)) + " " + content.trim() + "\n";
  });
  // Convert lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  // Convert paragraphs
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/ {2,}/g, " ");
  return text.trim();
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) {
      // Only keep chunks with meaningful content
      chunks.push(chunk);
    }
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

function inferApiModule(filepath: string, text: string): string {
  // Try to detect which bpy module this doc relates to
  if (text.includes("bpy.ops.mesh")) return "bpy.ops.mesh";
  if (text.includes("bpy.ops.object")) return "bpy.ops.object";
  if (text.includes("bpy.ops.armature")) return "bpy.ops.armature";
  if (text.includes("bpy.ops.anim")) return "bpy.ops.anim";
  if (text.includes("bpy.ops.render")) return "bpy.ops.render";
  if (text.includes("bpy.ops.transform")) return "bpy.ops.transform";
  if (text.includes("bpy.types")) return "bpy.types";
  if (text.includes("bpy.data")) return "bpy.data";
  if (text.includes("mathutils")) return "mathutils";

  // Infer from path
  if (filepath.includes("modeling")) return "bpy.ops.mesh";
  if (filepath.includes("animation")) return "bpy.ops.anim";
  if (filepath.includes("render")) return "bpy.ops.render";
  if (filepath.includes("sculpt")) return "bpy.ops.sculpt";
  if (filepath.includes("physics")) return "bpy.ops.physics";

  return "general";
}

// ---------------------------------------------------------------------------
// Document Processing
// ---------------------------------------------------------------------------

function collectHtmlFiles(dir: string, maxFiles = 500): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    if (files.length >= maxFiles) return;
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Prioritize relevant sections
        walk(fullPath);
      } else if (entry.name.endsWith(".html") && !entry.name.startsWith("_")) {
        files.push(fullPath);
      }
    }
  }

  // Process priority paths first
  for (const p of PRIORITY_PATHS) {
    walk(path.join(dir, p));
  }

  // Then the rest
  walk(dir);

  return [...new Set(files)]; // dedupe
}

export async function processDocuments(): Promise<DocChunk[]> {
  console.log(`[RAG Ingest] Processing Blender docs from ${DOCS_DIR}`);

  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`[RAG Ingest] Docs directory not found: ${DOCS_DIR}`);
    console.error(`[RAG Ingest] Place the Blender manual HTML at this path.`);
    return [];
  }

  const htmlFiles = collectHtmlFiles(DOCS_DIR);
  console.log(`[RAG Ingest] Found ${htmlFiles.length} HTML files`);

  const allChunks: DocChunk[] = [];
  let chunkId = 0;

  for (const file of htmlFiles) {
    try {
      const html = fs.readFileSync(file, "utf-8");
      const text = stripHtml(html);

      if (text.length < 100) continue; // skip trivially short pages

      const relativePath = path.relative(DOCS_DIR, file);
      const sectionPath = relativePath.replace(/\.html$/, "").replace(/[/\\]/g, " > ");
      const apiModule = inferApiModule(relativePath, text);

      const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);

      for (const chunk of chunks) {
        allChunks.push({
          id: `chunk_${chunkId++}`,
          text: chunk,
          section_path: sectionPath,
          source_file: relativePath,
          api_module: apiModule,
        });
      }
    } catch (err) {
      // Skip files that can't be read
    }
  }

  console.log(`[RAG Ingest] Created ${allChunks.length} chunks from ${htmlFiles.length} files`);
  return allChunks;
}

// ---------------------------------------------------------------------------
// Embedding Generation
// ---------------------------------------------------------------------------

export async function generateEmbeddings(chunks: DocChunk[]): Promise<DocChunk[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[RAG Ingest] No GEMINI_API_KEY — skipping embedding generation");
    return chunks;
  }

  const ai = new GoogleGenAI({ apiKey });
  const batchSize = 20;
  let processed = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    try {
      const response = await ai.models.embedContent({
        model: "text-embedding-004",
        contents: batch.map((c) => c.text),
      });

      // The response structure may vary — handle both array and single
      const embeddings = (response as any).embeddings || [(response as any).embedding];
      for (let j = 0; j < batch.length && j < embeddings.length; j++) {
        batch[j].embedding = embeddings[j]?.values || embeddings[j];
      }

      processed += batch.length;
      if (processed % 100 === 0) {
        console.log(`[RAG Ingest] Embedded ${processed}/${chunks.length} chunks`);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 100));
    } catch (err: any) {
      console.warn(`[RAG Ingest] Embedding batch failed: ${err.message}`);
      // Continue with remaining batches
    }
  }

  console.log(`[RAG Ingest] ✅ Embedded ${processed} chunks`);
  return chunks;
}

// ---------------------------------------------------------------------------
// Index Storage (JSON-based, no external vector DB dependency)
// ---------------------------------------------------------------------------

export async function saveIndex(chunks: DocChunk[]): Promise<void> {
  fs.mkdirSync(INDEX_DIR, { recursive: true });

  // Save chunks (without embeddings for human readability)
  const chunksFile = path.join(INDEX_DIR, "chunks.json");
  const chunksMeta = chunks.map(({ embedding, ...rest }) => rest);
  fs.writeFileSync(chunksFile, JSON.stringify(chunksMeta, null, 2));

  // Save embeddings separately (binary-ish for efficiency)
  const embeddingsFile = path.join(INDEX_DIR, "embeddings.json");
  const embeddingsData = chunks.map((c) => ({
    id: c.id,
    embedding: c.embedding || [],
  }));
  fs.writeFileSync(embeddingsFile, JSON.stringify(embeddingsData));

  // Save metadata
  const metaFile = path.join(INDEX_DIR, "meta.json");
  fs.writeFileSync(
    metaFile,
    JSON.stringify({
      created_at: new Date().toISOString(),
      chunk_count: chunks.length,
      embedded_count: chunks.filter((c) => c.embedding && c.embedding.length > 0).length,
      chunk_size: CHUNK_SIZE,
      chunk_overlap: CHUNK_OVERLAP,
      docs_source: DOCS_DIR,
    }, null, 2)
  );

  console.log(`[RAG Ingest] ✅ Index saved to ${INDEX_DIR}`);
  console.log(`[RAG Ingest]    ${chunks.length} chunks, ${chunksMeta.length} metadata records`);
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Blender API Docs Ingestion ===");
  console.log();

  const chunks = await processDocuments();
  if (chunks.length === 0) {
    console.error("No chunks generated. Check that the docs directory exists.");
    process.exit(1);
  }

  const embeddedChunks = await generateEmbeddings(chunks);
  await saveIndex(embeddedChunks);

  console.log();
  console.log("✅ Ingestion complete!");
  console.log(`   Run the retriever: npx tsx agent/knowledge/retriever.ts --query "create armature"`);
}

// Only run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
