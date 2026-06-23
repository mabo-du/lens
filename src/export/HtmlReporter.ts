import { ExportPayload, ExportPlugin, exporterRegistry } from './ExporterPlugin';
import type { CodeTreeNode } from '@/ipc/codes';
import Handlebars from 'handlebars';

const templateSource = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{project.name}} - Code Report</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.5; color: #333; max-width: 900px; margin: 0 auto; padding: 2rem; }
    h1 { border-bottom: 2px solid #ccc; padding-bottom: 0.5rem; }
    .code-section { margin-top: 2rem; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
    .code-header { background: #f8f9fa; padding: 1rem; border-bottom: 1px solid #ddd; display: flex; align-items: center; }
    .color-swatch { width: 16px; height: 16px; border-radius: 4px; margin-right: 8px; display: inline-block; }
    .annotation { padding: 1rem; border-bottom: 1px solid #eee; }
    .annotation:last-child { border-bottom: none; }
    .meta { font-size: 0.85rem; color: #666; margin-bottom: 0.5rem; }
    .segment { background: #fffde7; padding: 0.5rem; border-left: 4px solid #ffd54f; }
    .memo { margin-top: 0.5rem; font-size: 0.9rem; color: #444; background: #f1f5f9; padding: 0.5rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Project Report: {{project.name}}</h1>
  <p>Exported on {{date}}</p>

  {{#each codes}}
    <div class="code-section">
      <div class="code-header">
        <div class="color-swatch" style="background-color: {{this.color}}"></div>
        <h2 style="margin: 0; font-size: 1.25rem;">{{this.name}}</h2>
        <span style="margin-left: auto; color: #666; font-size: 0.9rem;">{{this.annotations.length}} annotations</span>
      </div>
      
      {{#if this.annotations.length}}
        {{#each this.annotations}}
          <div class="annotation">
            <div class="meta">
              <strong>{{this.documentTitle}}</strong> (Chars: {{this.startChar}} - {{this.endChar}})
            </div>
            <div class="segment">
              {{this.segment}}
            </div>
            {{#if this.memo}}
              <div class="memo">
                <strong>Memo:</strong> {{this.memo}}
              </div>
            {{/if}}
          </div>
        {{/each}}
      {{else}}
        <div class="annotation">
          <p style="color: #999; font-style: italic;">No annotations for this code.</p>
        </div>
      {{/if}}
    </div>
  {{/each}}
</body>
</html>
`;

export const HtmlReporter: ExportPlugin = {
  id: 'html',
  label: 'Printable Report (HTML)',
  fileExtension: 'html',
  mimeType: 'text/html',
  
  async export(payload: ExportPayload): Promise<string> {
    const docMap = new Map(payload.documents.map(d => [d.id, d]));
    const memoMap = new Map(payload.memos.map(m => [m.linkedSelectionId, m.body]));
    
    // Flatten codes and attach annotations
    const codesData: Record<string, unknown>[] = [];
    const flattenCodes = (nodes: CodeTreeNode[]) => {
      for (const node of nodes) {
        const anns = payload.annotations
          .filter(a => a.codeId === node.id)
          .map(a => {
            const doc = docMap.get(a.documentId);
            return {
              documentTitle: doc?.title || 'Unknown Document',
              startChar: a.startChar,
              endChar: a.endChar,
              segment: (doc?.plainText ?? '').substring(a.startChar, a.endChar),
              memo: memoMap.get(a.id) || null
            };
          });
        
        codesData.push({
          id: node.id,
          name: node.name,
          color: node.color,
          annotations: anns
        });
        
        if (node.children) flattenCodes(node.children);
      }
    };
    flattenCodes(payload.codes);

    const template = Handlebars.compile(templateSource);
    const html = template({
      project: payload.project,
      date: new Date().toLocaleString(),
      codes: codesData
    });

    return html;
  }
};

exporterRegistry.register(HtmlReporter);
