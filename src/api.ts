import type { Connection, Protocol } from './config';
import type { Attachment } from './attachments';
import { ResponseText } from './responseText';

export interface Turn { role: 'user' | 'assistant'; content: string; attachments?: Attachment[] }

export class ChatError extends Error {}

export function endpointFor(baseUrl: string, protocol: Protocol): string {
  let url: URL;
  try { url = new URL(baseUrl.trim()); }
  catch { throw new ChatError('请输入完整的接口地址，例如 https://example.com/v1。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ChatError('接口地址须使用 HTTP 或 HTTPS，且不能包含账号、查询参数或锚点。');
  }
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol !== 'https:') {
    throw new ChatError('当前网页使用 HTTPS，接口地址也需要使用 HTTPS。');
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|responses|messages)$/, '');
  const base = !path ? '/v1' : path;
  const suffix = { responses: 'responses', messages: 'messages', chat: 'chat/completions' }[protocol];
  url.pathname = `${base}/${suffix}`;
  return url.toString();
}

function wireTurn(turn: Turn, protocol: Protocol) {
  const { role, content, attachments } = turn;
  if (role !== 'user' || !attachments?.length) return { role, content };
  const textType = protocol === 'responses' ? 'input_text' : 'text';
  const parts: Record<string, unknown>[] = [];
  if (content) parts.push({ type: textType, text: content });
  for (const file of attachments) {
    if (file.kind === 'text') {
      parts.push({ type: textType, text: `附件：${file.name}\n\n${file.data}` });
    } else if (protocol === 'messages' && file.kind === 'pdf' && file.pages?.length) {
      parts.push({ type: 'text', text: `PDF 附件：${file.name}，以下 ${file.pages.length} 张图片依次是文件的每一页。` });
      for (const page of file.pages) {
        parts.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: page.slice(page.indexOf(',') + 1) } });
      }
    } else if (protocol === 'messages') {
      parts.push({
        type: file.kind === 'image' ? 'image' : 'document',
        source: { type: 'base64', media_type: file.mime, data: file.data.slice(file.data.indexOf(',') + 1) },
        ...(file.kind === 'pdf' ? { title: file.name } : {}),
      });
    } else if (file.kind === 'image') {
      parts.push(protocol === 'responses'
        ? { type: 'input_image', image_url: file.data }
        : { type: 'image_url', image_url: { url: file.data } });
    } else {
      parts.push(protocol === 'responses'
        ? { type: 'input_file', filename: file.name, file_data: file.data }
        : { type: 'file', file: { filename: file.name, file_data: file.data } });
    }
  }
  return { role, content: parts };
}

function requestBody(connection: Connection, turns: Turn[]) {
  const common = { model: connection.model.trim(), stream: true };
  const messages = turns.map(turn => wireTurn(turn, connection.protocol));
  if (connection.protocol === 'responses') return {
    ...common, input: messages, store: false,
    tools: [{ type: 'web_search' }], tool_choice: 'auto',
  };
  if (connection.protocol === 'messages') return { ...common, messages, max_tokens: 8192 };
  return { ...common, messages };
}

function apiError(data: any): string | undefined {
  const error = data?.error || data?.response?.error;
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  if (data?.type === 'error') return data.message || '服务返回了一个错误，请稍后重试。';
}

function fullText(data: any, protocol: Protocol): string {
  if (protocol === 'chat') return data.choices?.[0]?.message?.content || '';
  if (protocol === 'messages') return (data.content || []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('');
  const output = new ResponseText();
  output.snapshot(data);
  return output.render();
}

export async function streamChat(
  connection: Connection,
  turns: Turn[],
  signal: AbortSignal,
  onText: (text: string) => void,
  onActivity?: (searching: boolean) => void,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (connection.protocol === 'messages') {
    headers['x-api-key'] = connection.apiKey.trim();
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else headers.Authorization = `Bearer ${connection.apiKey.trim()}`;

  const body = JSON.stringify(requestBody(connection, turns));
  if (new Blob([body]).size > 24 * 1024 * 1024) {
    throw new ChatError('当前对话的附件总量过大，请开启新对话后发送较少的附件。');
  }

  let response: Response;
  try {
    response = await fetch(endpointFor(connection.baseUrl, connection.protocol), {
      method: 'POST', headers, body, signal,
      credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (signal.aborted || error instanceof ChatError) throw error;
    throw new ChatError('无法连接到接口。请检查网络和接口地址，并确认中转服务允许网页跨域访问（CORS）。');
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const messages: Record<number, string> = {
      401: '模型连接认证失败。',
      403: '服务暂时拒绝了请求，请稍后重试。',
      404: '找不到接口或模型，请检查接口地址、接口格式和模型 ID。',
      413: '附件或对话内容过大，请减少文件大小，或开启新对话。',
      429: '请求过于频繁或额度不足，请稍后重试或检查账户额度。',
    };
    throw new ChatError(messages[response.status] || apiError(data) || `服务暂时无法响应（${response.status}），请稍后重试。`);
  }

  if (response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json();
    const error = apiError(data);
    if (error) throw new ChatError(error);
    const text = fullText(data, connection.protocol);
    if (text) onText(text);
    if (data.status === 'incomplete') throw new ChatError('回复未完成，可能已达到输出长度限制。');
    if (!text) throw new ChatError('接口没有返回文字，请检查模型 ID 和接口格式。');
    return;
  }

  if (!response.body) throw new ChatError('浏览器未能读取回复，请重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finished = false;
  let limited = false;
  const output = new ResponseText();
  const searches = new Set<string>();

  const consume = (frame: string) => {
    const raw = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    if (!raw) return;
    if (raw.trim() === '[DONE]') { finished = true; return; }
    let data: any;
    try { data = JSON.parse(raw); }
    catch { throw new ChatError('接口返回了无法解析的数据，请检查接口格式。'); }
    const error = apiError(data);
    if (error) throw new ChatError(error);
    let delta = '';
    if (connection.protocol === 'responses') {
      const searchId = data.item_id || data.item?.id || String(data.output_index ?? 0);
      if (data.type === 'response.web_search_call.in_progress' || data.type === 'response.web_search_call.searching'
        || (data.type === 'response.output_item.added' && data.item?.type === 'web_search_call')) searches.add(searchId);
      if (data.type === 'response.web_search_call.completed'
        || (data.type === 'response.output_item.done' && data.item?.type === 'web_search_call')) searches.delete(searchId);
      onActivity?.(searches.size > 0);
      output.event(data);
      const nextText = output.render();
      if (nextText !== text) { text = nextText; onText(text); }
      if (data.type === 'response.completed') {
        finished = true;
      }
      if (data.type === 'response.incomplete') throw new ChatError('回复未完成，可能已达到输出长度限制。可以重新尝试。');
      if (data.type === 'response.failed') throw new ChatError('模型未能完成回复，请重试。');
    } else if (connection.protocol === 'messages') {
      if (data.type === 'content_block_start' && data.content_block?.type === 'text') delta = data.content_block.text || '';
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') delta = data.delta.text || '';
      if (data.type === 'message_stop') finished = true;
      if (data.type === 'message_delta' && data.delta?.stop_reason === 'max_tokens') limited = true;
    } else {
      delta = data.choices?.[0]?.delta?.content || '';
      if (data.choices?.[0]?.finish_reason) finished = true;
      if (data.choices?.[0]?.finish_reason === 'length') limited = true;
    }
    if (delta) { text += delta; onText(text); }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (finished || done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (limited) throw new ChatError('回复已达到输出长度限制。');
    if (!finished) throw new ChatError('连接提前中断，回复可能不完整。请重新尝试。');
    if (!text) throw new ChatError('接口没有返回文字，请检查模型 ID 和接口格式。');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
