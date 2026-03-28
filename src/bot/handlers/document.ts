import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { extractText } from '../../utils/file-extract.js';
import { storePensieveEntryDedup } from '../../pensieve/store.js';
import { embedAndStoreChunked, chunkText } from '../../pensieve/embeddings.js';

/**
 * Handle a Telegram document upload: download, extract text, store with dedup,
 * embed (chunked), and confirm to the user.
 *
 * Observability:
 * - `bot.document` (info): fileName, mimeType, extractedLength, entryId
 * - `bot.document.error` (error): fileName, mimeType, error message
 */
export async function handleDocument(ctx: {
  chat: { id: number };
  from: { id: number };
  message: {
    document: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
    };
  };
  getFile: () => Promise<{ file_path?: string }>;
  reply: (text: string) => Promise<unknown>;
}): Promise<void> {
  const doc = ctx.message.document;
  const fileName = doc.file_name ?? 'unnamed';
  const mimeType = doc.mime_type ?? 'application/octet-stream';

  try {
    // 1. Get file path from Telegram
    const file = await ctx.getFile();
    if (!file.file_path) {
      await ctx.reply("I couldn't download that file — Telegram didn't provide a path.");
      return;
    }

    // 2. Download the file binary
    const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`File download failed: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Extract text
    const { text, pageCount } = await extractText(buffer, mimeType);
    if (!text.trim()) {
      await ctx.reply(`I opened '${fileName}' but couldn't find any text in it.`);
      return;
    }

    // 4. Store with content-hash dedup
    const entry = await storePensieveEntryDedup(text, 'telegram_file', {
      fileName,
      mimeType,
      telegramFileId: doc.file_id,
      telegramChatId: ctx.chat.id,
      pageCount,
    });

    // 5. Embed (chunked if long)
    await embedAndStoreChunked(entry.id, entry.content);

    // 6. Confirm to user
    const chunkCount = chunkText(text).length;
    const pageInfo = pageCount ? `${pageCount} pages, ` : '';
    await ctx.reply(
      `Got it — I've read '${fileName}' (${pageInfo}${chunkCount} sections). Ask me anything about it.`,
    );

    logger.info(
      {
        fileName,
        mimeType,
        extractedLength: text.length,
        entryId: entry.id,
      },
      'bot.document',
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        fileName,
        mimeType,
        error: errMsg.slice(0, 200),
      },
      'bot.document.error',
    );
    await ctx.reply(
      `I had trouble reading '${fileName}'. ${mimeType === 'application/pdf' ? 'The PDF might be corrupted or image-only.' : 'Please try a different format.'}`,
    );
  }
}
