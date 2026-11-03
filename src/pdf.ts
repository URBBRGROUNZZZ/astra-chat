import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// Some relay services discard Anthropic document blocks. Render PDF pages in
// the browser so Claude receives supported images, including scanned pages.
export async function readPdf(file: File): Promise<string[]> {
  const resourceBase = `${import.meta.env.BASE_URL}pdfjs/`;
  const task = getDocument({
    data: await file.arrayBuffer(), useSystemFonts: true,
    cMapUrl: `${resourceBase}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${resourceBase}standard_fonts/`, wasmUrl: `${resourceBase}wasm/`,
  });
  task.onPassword = () => { void task.destroy(); };
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 20) throw new Error('PDF 最多支持 20 页，请拆分后发送。');
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(original.width, original.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      pages.push(canvas.toDataURL('image/jpeg', .88));
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    return pages;
  } catch (error) {
    if (error instanceof Error && error.message.includes('PDF 最多')) throw error;
    throw new Error('PDF 无法读取，请确认文件完整且没有密码。');
  } finally { await task.destroy(); }
}
