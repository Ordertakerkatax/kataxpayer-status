import { extractText, getDocumentProxy } from 'unpdf';

/**
 * The text layer of a PDF, pages joined. A scan has none and comes back empty,
 * which the parser turns into a low-confidence advisory with empty fields.
 * Free of path aliases so the parser tests can import it under plain node.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
