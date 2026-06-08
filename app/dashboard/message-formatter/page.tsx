// @ts-nocheck
'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Link2, Eraser, Copy, Check, RotateCcw, Pilcrow,
} from 'lucide-react';

// ============================================================
// HTML -> JobTread-markdown converter (pure, DOM-based).
// Logic unit-tested with jsdom before shipping. JobTread renders
// standard markdown: # headings, **bold**, *italic*, ~~strike~~,
// - bullets, 1. numbers, [text](url).
// ============================================================
function htmlToMarkdown(root: HTMLElement): string {
  const NBSP = / /g;
  function escapeInline(text: string): string {
    return text.replace(NBSP, ' ').replace(/([\\`*_])/g, '\\$1');
  }
  function escapeLeadingMarker(text: string): string {
    return text.replace(/^(\s*)(#{1,6}\s|[-+*]\s|\d+\.\s|>\s)/, (m, ws, mk) => ws + '\\' + mk);
  }
  function inline(node: any): string {
    if (node.nodeType === 3) return escapeInline(node.nodeValue.replace(/\s+/g, ' '));
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    const inner = inlineChildren(node);
    const bare = inner.trim();
    const style = node.getAttribute('style') || '';
    const isBold = tag === 'strong' || tag === 'b' || /font-weight:\s*(bold|[6-9]00)/.test(style);
    const isItalic = tag === 'em' || tag === 'i' || /font-style:\s*italic/.test(style);
    const isStrike = tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(style);
    if (tag === 'a') { const href = node.getAttribute('href') || ''; return bare ? `[${inner}](${href})` : ''; }
    let out = inner;
    if (isStrike && bare) out = `~~${out.trim()}~~`;
    if (isItalic && bare) out = `*${out.trim()}*`;
    if (isBold && bare) out = `**${out.trim()}**`;
    return out;
  }
  function inlineChildren(node: any): string { let s = ''; node.childNodes.forEach((c: any) => { s += inline(c); }); return s; }
  function listToMd(node: any, ordered: boolean, depth: number): string {
    const indent = '  '.repeat(depth); const lines: string[] = []; let i = 1;
    node.childNodes.forEach((li: any) => {
      if (li.nodeType === 1 && li.tagName.toLowerCase() === 'li') {
        let ownInline = ''; const nested: any[] = [];
        li.childNodes.forEach((c: any) => {
          if (c.nodeType === 1 && (c.tagName.toLowerCase() === 'ul' || c.tagName.toLowerCase() === 'ol')) nested.push(c);
          else ownInline += inline(c);
        });
        const marker = ordered ? `${i}. ` : '- ';
        lines.push(indent + marker + ownInline.trim());
        nested.forEach((n) => { lines.push(listToMd(n, n.tagName.toLowerCase() === 'ol', depth + 1)); });
        i++;
      }
    });
    return lines.join('\n');
  }
  function block(node: any): string {
    if (node.nodeType === 3) { const t = node.nodeValue.replace(NBSP, ' '); return t.trim() ? escapeLeadingMarker(escapeInline(t.trim())) : ''; }
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case 'h1': return '# ' + inlineChildren(node).trim();
      case 'h2': return '## ' + inlineChildren(node).trim();
      case 'h3': return '### ' + inlineChildren(node).trim();
      case 'h4': return '#### ' + inlineChildren(node).trim();
      case 'ul': return listToMd(node, false, 0);
      case 'ol': return listToMd(node, true, 0);
      case 'blockquote': return inlineChildren(node).trim().split('\n').map((l) => '> ' + l).join('\n');
      case 'br': return '';
      case 'div': case 'p': {
        const hasBlockChild = Array.from(node.childNodes).some((c: any) => c.nodeType === 1 && ['ul','ol','h1','h2','h3','h4','div','p','blockquote'].includes(c.tagName.toLowerCase()));
        if (hasBlockChild) return serializeChildren(node);
        return escapeLeadingMarker(inlineChildren(node).trim());
      }
      default: return escapeLeadingMarker(inlineChildren(node).trim());
    }
  }
  function serializeChildren(parent: any): string {
    const blocks: string[] = [];
    parent.childNodes.forEach((node: any) => { const md = block(node); if (md !== '' && md != null) blocks.push(md); });
    return blocks.join('\n\n');
  }
  let md = serializeChildren(root);
  md = md.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  return md;
}

// ============================================================
// Toolbar button
// ============================================================
function TBtn({ onClick, title, active, children }: any) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="flex items-center justify-center rounded-md transition-colors"
      style={{
        width: 34, height: 34,
        background: active ? 'rgba(104,5,10,0.10)' : 'transparent',
        color: active ? '#68050a' : '#5a5550',
        border: '1px solid transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#f3f0ec'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}
function Divider() {
  return <div style={{ width: 1, height: 22, background: '#e8e5e0', margin: '0 4px' }} />;
}

const SAMPLE = `<h2>Project Update</h2><div>Hi Jane, here is where things stand this week:</div><ul><li>Framing is <b>complete</b></li><li>Electrical rough-in scheduled for <i>Friday</i></li></ul><div>Let me know if you have any questions.</div>`;

export default function MessageFormatterPage() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [markdown, setMarkdown] = useState('');
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});

  // Recompute markdown from the live editor DOM.
  const regen = useCallback(() => {
    if (!editorRef.current) return;
    setMarkdown(htmlToMarkdown(editorRef.current));
  }, []);

  // Track which inline formats are active for toolbar highlighting.
  const refreshActive = useCallback(() => {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        strike: document.queryCommandState('strikeThrough'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      });
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    // Seed with a sample so first-time users see how it works.
    if (editorRef.current && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = SAMPLE;
      regen();
    }
    document.addEventListener('selectionchange', refreshActive);
    return () => document.removeEventListener('selectionchange', refreshActive);
  }, [regen, refreshActive]);

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    refreshActive();
    regen();
  }

  function setHeading(level: number) {
    // Toggle: if the block is already this heading, drop back to paragraph.
    exec('formatBlock', `<h${level}>`);
  }
  function setParagraph() { exec('formatBlock', '<div>'); }

  function addLink() {
    const sel = window.getSelection();
    const hasText = sel && sel.toString().trim().length > 0;
    const url = window.prompt('Link URL (https://...)');
    if (!url) return;
    if (hasText) {
      exec('createLink', url);
    } else {
      // No selection: insert the URL as its own linked text.
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`);
      regen();
    }
  }

  // Paste as plain text so pasted Word/Docs HTML doesn't create messy markdown.
  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    regen();
  }

  function clearAll() {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setMarkdown('');
    editorRef.current?.focus();
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // Fallback for older browsers / insecure contexts.
      const ta = document.createElement('textarea');
      ta.value = markdown; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold" style={{ color: '#1a1a1a' }}>Message Formatter</h1>
        <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
          Write and format like a Word doc, then copy clean markdown to paste into a JobTread message.
        </p>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        {/* Editor card */}
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e8e5e0' }}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-0.5 px-2 py-2" style={{ borderBottom: '1px solid #e8e5e0', background: '#fbfaf8' }}>
            <TBtn title="Bold (Ctrl+B)" active={active.bold} onClick={() => exec('bold')}><Bold size={17} /></TBtn>
            <TBtn title="Italic (Ctrl+I)" active={active.italic} onClick={() => exec('italic')}><Italic size={17} /></TBtn>
            <TBtn title="Strikethrough" active={active.strike} onClick={() => exec('strikeThrough')}><Strikethrough size={17} /></TBtn>
            <Divider />
            <TBtn title="Heading 1" onClick={() => setHeading(1)}><Heading1 size={18} /></TBtn>
            <TBtn title="Heading 2" onClick={() => setHeading(2)}><Heading2 size={18} /></TBtn>
            <TBtn title="Heading 3" onClick={() => setHeading(3)}><Heading3 size={18} /></TBtn>
            <TBtn title="Normal text" onClick={setParagraph}><Pilcrow size={17} /></TBtn>
            <Divider />
            <TBtn title="Bulleted list" active={active.ul} onClick={() => exec('insertUnorderedList')}><List size={18} /></TBtn>
            <TBtn title="Numbered list" active={active.ol} onClick={() => exec('insertOrderedList')}><ListOrdered size={18} /></TBtn>
            <TBtn title="Insert link" onClick={addLink}><Link2 size={17} /></TBtn>
            <Divider />
            <TBtn title="Clear formatting" onClick={() => exec('removeFormat')}><Eraser size={17} /></TBtn>
          </div>

          {/* Editable area */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={regen}
            onKeyUp={() => { refreshActive(); }}
            onMouseUp={refreshActive}
            onPaste={onPaste}
            className="jt-editor px-4 py-4 outline-none"
            style={{ minHeight: 240, fontSize: 15, lineHeight: 1.6, color: '#1a1a1a' }}
          />
        </div>

        {/* Output card */}
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e8e5e0' }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid #e8e5e0', background: '#fbfaf8' }}>
            <span className="text-sm font-medium" style={{ color: '#5a5550' }}>Markdown for JobTread</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearAll}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors"
                style={{ color: '#8a8078', border: '1px solid #e8e5e0', background: '#ffffff' }}
              >
                <RotateCcw size={13} /> Clear
              </button>
              <button
                type="button"
                onClick={copyMarkdown}
                disabled={!markdown}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  color: '#ffffff',
                  background: copied ? '#3f7d4f' : (markdown ? '#68050a' : '#cbc6bf'),
                  border: 'none', cursor: markdown ? 'pointer' : 'default',
                }}
              >
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy markdown</>}
              </button>
            </div>
          </div>
          <pre
            className="px-4 py-4 m-0 whitespace-pre-wrap break-words"
            style={{ fontSize: 13.5, lineHeight: 1.6, color: '#33302c', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minHeight: 120 }}
          >
            {markdown || <span style={{ color: '#b8b2aa' }}>Formatted text will appear here as markdown…</span>}
          </pre>
        </div>
      </div>

      {/* Editor display styles so headings/lists look right while typing */}
      <style jsx global>{`
        .jt-editor h1 { font-size: 1.5rem; font-weight: 700; margin: 0.4em 0; line-height: 1.25; }
        .jt-editor h2 { font-size: 1.25rem; font-weight: 700; margin: 0.4em 0; line-height: 1.3; }
        .jt-editor h3 { font-size: 1.1rem; font-weight: 600; margin: 0.4em 0; line-height: 1.3; }
        .jt-editor ul { list-style: disc; padding-left: 1.4em; margin: 0.4em 0; }
        .jt-editor ol { list-style: decimal; padding-left: 1.5em; margin: 0.4em 0; }
        .jt-editor li { margin: 0.15em 0; }
        .jt-editor a { color: #68050a; text-decoration: underline; }
        .jt-editor:empty:before { content: 'Start typing your message…'; color: #b8b2aa; }
      `}</style>
    </div>
  );
}
