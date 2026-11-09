interface TextPart { text: string; annotations: any[] }

// Responses can emit several messages (before and after a search). Citation
// offsets are local to each text part, not to the whole displayed answer.
export class ResponseText {
  private parts = new Map<string, TextPart>();

  private part(output = 0, content = 0): TextPart {
    const key = `${output}:${content}`;
    if (!this.parts.has(key)) this.parts.set(key, { text: '', annotations: [] });
    return this.parts.get(key)!;
  }

  private setPart(value: any, output: number, content: number) {
    if (value?.type !== 'output_text' && value?.type !== 'refusal') return;
    const part = this.part(output, content);
    part.text = value.text ?? value.refusal ?? part.text;
    if (Array.isArray(value.annotations)) part.annotations = value.annotations;
  }

  private setItem(item: any, output: number) {
    if (item?.type !== 'message') return;
    item.content?.forEach((part: any, index: number) => this.setPart(part, output, index));
  }

  snapshot(response: any) {
    response?.output?.forEach((item: any, index: number) => this.setItem(item, index));
    if (!this.parts.size && response?.output_text) this.part().text = response.output_text;
  }

  event(data: any) {
    const { type, output_index = 0, content_index = 0 } = data;
    if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
      this.part(output_index, content_index).text += data.delta || '';
    } else if (type === 'response.output_text.done' || type === 'response.refusal.done') {
      this.part(output_index, content_index).text = data.text ?? data.refusal ?? '';
    } else if (type === 'response.output_text.annotation.added') {
      const annotations = this.part(output_index, content_index).annotations;
      annotations[data.annotation_index ?? annotations.length] = data.annotation;
    } else if (type === 'response.content_part.done') {
      this.setPart(data.part, output_index, content_index);
    } else if (type === 'response.output_item.done') {
      this.setItem(data.item, output_index);
    } else if (data.response) {
      this.snapshot(data.response);
    }
  }

  render(): string {
    const sources = new Map<string, number>();
    return [...this.parts.entries()]
      .sort(([a], [b]) => {
        const [ao, ac] = a.split(':').map(Number), [bo, bc] = b.split(':').map(Number);
        return ao - bo || ac - bc;
      })
      .map(([, part]) => citeText(part, sources)).join('');
  }
}

function citeText({ text, annotations }: TextPart, sources: Map<string, number>): string {
  const characters = Array.from(text);
  const inserts = new Map<number, string[]>();
  const seen = new Set<string>();
  for (const annotation of annotations) {
    if (annotation?.type !== 'url_citation' || typeof annotation.url !== 'string') continue;
    let url: URL;
    try { url = new URL(annotation.url); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol)) continue;
    // Some relays already supply clickable Markdown citations in the answer.
    if (text.includes(`](${annotation.url})`) || text.includes(`](<${annotation.url}>`)) continue;
    const end = Number.isInteger(annotation.end_index) && annotation.end_index >= 0
      ? Math.min(annotation.end_index, characters.length) : characters.length;
    const key = `${end}:${url.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sources.has(url.href)) sources.set(url.href, sources.size + 1);
    const href = url.href.replace(/[<>]/g, value => encodeURIComponent(value));
    const links = inserts.get(end) || [];
    links.push(`[${sources.get(url.href)}](<${href}>)`);
    inserts.set(end, links);
  }
  for (const [end, links] of [...inserts].sort(([a], [b]) => b - a)) {
    characters.splice(end, 0, ` ${links.join(' ')}`);
  }
  // Internal citation tokens are not useful links in a standalone client.
  return characters.join('').replace(/\uE200cite[^\uE201]*\uE201/g, '');
}
