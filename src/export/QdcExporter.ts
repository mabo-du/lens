import { ExportPayload, ExportPlugin, exporterRegistry } from './ExporterPlugin';
import type { CodeTreeNode } from '@/ipc/codes';
import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom';

function colorToArgb(hex: string): string {
  if (hex.startsWith('#')) {
    return `#FF${hex.substring(1).toUpperCase()}`;
  }
  return '#FF6366F1';
}

export const QdcExporter: ExportPlugin = {
  id: 'qdc',
  label: 'REFI-QDA Codebook (.qdc)',
  fileExtension: 'qdc',
  mimeType: 'application/xml',
  
  async export(payload: ExportPayload): Promise<string> {
    const impl = new DOMImplementation();
    const doc = impl.createDocument('urn:QDA-XML:codebook:1.0', 'CodeBook', null);
    const root = doc.documentElement;
    if (!root) throw new Error("Failed to create XML root");
    
    root.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
    root.setAttribute('xsi:schemaLocation', 'urn:QDA-XML:codebook:1.0 http://schema.qdasoftware.org/versions/Codebook/v1.0/Codebook.xsd');

    const codesEl = doc.createElement('Codes');
    
    type XmlElement = ReturnType<typeof doc.createElement>;
    const appendCodes = (nodes: CodeTreeNode[], parentEl: XmlElement) => {
      for (const code of nodes) {
        const codeEl = doc.createElement('Code');
        codeEl.setAttribute('guid', code.id);
        codeEl.setAttribute('name', code.name);
        codeEl.setAttribute('color', colorToArgb(code.color));
        codeEl.setAttribute('isCodable', 'true');
        
        if (code.description) {
          const descEl = doc.createElement('Description');
          descEl.textContent = code.description;
          codeEl.appendChild(descEl);
        }

        if (code.children && code.children.length > 0) {
          appendCodes(code.children, codeEl);
        }
        parentEl.appendChild(codeEl);
      }
    };
    
    appendCodes(payload.codes, codesEl);
    root.appendChild(codesEl);

    const serializer = new XMLSerializer();
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(doc)}`;
  }
};

exporterRegistry.register(QdcExporter);
