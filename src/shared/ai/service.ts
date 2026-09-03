/**
 * FormGen - Multi-Provider AI Service & Structured Generation
 * Main AI Orchestrator: Multi-Provider Dispatch, Chunking Pipeline & JSON Repair
 * Path: src/shared/ai/service.ts
 */

import { FormRecord } from '../types';
import {
  GenerateFormDataParams,
  ChunkProgress,
  ProgressCallback,
} from './types';
import { getAIAdapter } from './adapters';
import { assemblePrompts } from './prompt';
import { parseAndConformAIResponse } from './repair';
import { generateDeterministicFallback } from './heuristics';

// ============================================================================
// 1. Chunking Pipeline Constants
// ============================================================================

export const CHUNK_SIZE_BATCH_100 = 10;
export const CONCURRENCY_LIMIT = 2;

// ============================================================================
// 2. High-Level AI Generation Orchestrator
// ============================================================================

/**
 * Executes structured synthetic data generation across Gemini, OpenAI, Ollama,
 * or Custom endpoints. Handles chunking, progress callbacks, repair, and fallbacks.
 */
export async function generateFormData(params: GenerateFormDataParams): Promise<FormRecord[]> {
  const {
    provider,
    config,
    defaults,
    schema,
    count,
    abortSignal,
    onProgress,
  } = params;

  const adapter = getAIAdapter(provider);
  const locale = defaults?.locale || 'pt-BR';
  const temperature = defaults?.temperature ?? 0.7;

  // Single sub-batch helper function
  async function fetchSubBatch(subCount: number, chunkIndex: number): Promise<FormRecord[]> {
    if (abortSignal?.aborted) {
      throw new Error('A geração foi abortada pelo usuário.');
    }

    const { systemPrompt, userPrompt } = assemblePrompts(schema, subCount, locale);

    try {
      const result = await adapter.generate(config, {
        systemPrompt,
        userPrompt,
        temperature,
        abortSignal,
      });

      return parseAndConformAIResponse(result.rawText, schema, subCount);
    } catch (err) {
      console.warn(
        `[FormGen AI] Falha no chunk ${chunkIndex + 1} (${subCount} registros). Usando gerador determinístico:`,
        err
      );

      // Fault-tolerant synthetic fallback for this chunk
      const fallbackRecords: FormRecord[] = [];
      const fields = schema.fields || [];

      for (let i = 0; i < subCount; i++) {
        const record: FormRecord = {};
        const globalIdx = chunkIndex * subCount + i;

        for (const field of fields) {
          const val = generateDeterministicFallback(field, globalIdx);
          record[field.name] = val;
          if (field.id) record[field.id] = val;
          if (field.formgenId) record[field.formgenId] = val;
        }

        fallbackRecords.push(record);
      }

      return fallbackRecords;
    }
  }

  // --------------------------------------------------------------------------
  // Case A: 1 or 10 records (single call)
  // --------------------------------------------------------------------------
  if (count <= 10) {
    if (onProgress) {
      onProgress({
        completedRecords: 0,
        totalRecords: count,
        currentChunk: 1,
        totalChunks: 1,
        percent: 0,
        status: 'running',
      });
    }

    const records = await fetchSubBatch(count, 0);

    if (onProgress) {
      onProgress({
        completedRecords: records.length,
        totalRecords: count,
        currentChunk: 1,
        totalChunks: 1,
        percent: 100,
        status: 'completed',
      });
    }

    return records.slice(0, count);
  }

  // --------------------------------------------------------------------------
  // Case B: 100 records (chunking pipeline)
  // --------------------------------------------------------------------------
  const chunkSize = CHUNK_SIZE_BATCH_100;
  const totalChunks = Math.ceil(count / chunkSize);
  const aggregatedRecords: FormRecord[] = [];

  // Phase 1: Fast-Path chunk 0 (gives initial 10 records quickly)
  if (onProgress) {
    onProgress({
      completedRecords: 0,
      totalRecords: count,
      currentChunk: 1,
      totalChunks,
      percent: 0,
      status: 'running',
    });
  }

  const chunk0Records = await fetchSubBatch(chunkSize, 0);
  aggregatedRecords.push(...chunk0Records);

  if (onProgress) {
    onProgress({
      completedRecords: aggregatedRecords.length,
      totalRecords: count,
      currentChunk: 1,
      totalChunks,
      percent: Math.round((aggregatedRecords.length / count) * 100),
      status: 'running',
    });
  }

  // Phase 2: Background prefetch remaining chunks with bounded concurrency
  const remainingIndices = Array.from({ length: totalChunks - 1 }, (_, i) => i + 1);
  let nextChunkPointer = 0;

  async function worker(): Promise<void> {
    while (nextChunkPointer < remainingIndices.length) {
      if (abortSignal?.aborted) return;

      const chunkIdx = remainingIndices[nextChunkPointer++];
      if (chunkIdx === undefined) break;

      const subCount = Math.min(chunkSize, count - chunkIdx * chunkSize);
      const chunkRecords = await fetchSubBatch(subCount, chunkIdx);
      aggregatedRecords.push(...chunkRecords);

      if (onProgress) {
        const completed = Math.min(aggregatedRecords.length, count);
        onProgress({
          completedRecords: completed,
          totalRecords: count,
          currentChunk: chunkIdx + 1,
          totalChunks,
          percent: Math.min(100, Math.round((completed / count) * 100)),
          status: completed >= count ? 'completed' : 'running',
        });
      }
    }
  }

  const pool = Array.from({ length: Math.min(CONCURRENCY_LIMIT, remainingIndices.length) }, () =>
    worker()
  );
  await Promise.all(pool);

  // Guarantee exact count
  while (aggregatedRecords.length < count) {
    const idx = aggregatedRecords.length;
    const record: FormRecord = {};
    for (const field of schema.fields || []) {
      const val = generateDeterministicFallback(field, idx);
      record[field.name] = val;
      if (field.id) record[field.id] = val;
      if (field.formgenId) record[field.formgenId] = val;
    }
    aggregatedRecords.push(record);
  }

  if (onProgress) {
    onProgress({
      completedRecords: count,
      totalRecords: count,
      currentChunk: totalChunks,
      totalChunks,
      percent: 100,
      status: 'completed',
    });
  }

  return aggregatedRecords.slice(0, count);
}
