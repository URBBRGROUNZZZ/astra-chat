export interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: 'image' | 'pdf' | 'text';
  mime: string;
  data: string;
  pages?: string[];
}

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200_000;
const textExtensions = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'log', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'sh', 'sql'];
export const FILE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', '.pdf', '.docx', ...textExtensions.map(ext => `.${ext}`)].join(',');
let sequence = 0;

function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

async function readImage(file: File, mime: string) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error('图片无法读取，请换成 JPG、PNG 或 WebP。'); });
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (longest <= 2048 && mime !== 'image/gif') return { data: await dataUrl(new Blob([file], { type: mime })), mime };
    const scale = Math.min(1, 2048 / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片处理失败，请重新选择。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', .9), mime: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}

function checkText(text: string): string {
  if (!text.trim()) throw new Error('文件没有可读取的文字。扫描件请使用 PDF 或图片。');
  if (text.includes('\0')) throw new Error('这不是可读取的文本文件。');
  if (text.length > MAX_TEXT_LENGTH) throw new Error('文件文字过长，请拆分为较小的文件（最多 20 万字符）。');
  return text;
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (!file.size) throw new Error('文件为空。');
  if (file.size > MAX_FILE_BYTES) throw new Error('单个文件不能超过 5 MB。');
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const common = { id: `attachment-${Date.now()}-${++sequence}`, name: file.name, size: file.size };
  const imageMime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[ext];
  const mime = imageMime || file.type;
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
    return { ...common, kind: 'image', ...await readImage(file, mime) };
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
    if (!header.includes('%PDF-')) throw new Error('PDF 文件格式无效。');
    const { readPdf } = await import('./pdf');
    const pages = await readPdf(file);
    return { ...common, kind: 'pdf', mime: 'application/pdf', data: await dataUrl(new Blob([file], { type: 'application/pdf' })), pages };
  }
  if (ext === 'docx') {
    try {
      const { extractRawText } = await import('mammoth');
      const result = await extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return { ...common, kind: 'text', mime: 'text/plain', data: checkText(result.value) };
    } catch (error) {
      if (error instanceof Error && /文件没有|文件文字/.test(error.message)) throw error;
      throw new Error('Word 文件无法读取，请使用未加密的 DOCX，或导出为 PDF。');
    }
  }
  if (textExtensions.includes(ext) || (mime.startsWith('text/') && !mime.includes('rtf'))) {
    let text: string;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error('文本编码无法读取，请保存为 UTF-8 后重试。'); }
    return { ...common, kind: 'text', mime: 'text/plain', data: checkText(text) };
  }
  throw new Error('暂不支持此格式。请选择图片、PDF、DOCX、文本或代码文件。');
}
