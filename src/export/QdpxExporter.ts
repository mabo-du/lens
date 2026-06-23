import { ExportPayload, ExportPlugin, exporterRegistry } from './ExporterPlugin';
import type { CodeTreeNode } from '@/ipc/codes';
import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { readFile } from '@tauri-apps/plugin-fs';

function colorToArgb(hex: string): string {
  // Convert #RRGGBB to #FFFFFFFF (assuming full opacity FF)
  if (hex.startsWith('#')) {
    return `#FF${hex.substring(1).toUpperCase()}`;
  }
  return '#FF6366F1'; // fallback
}

export const QdpxExporter: ExportPlugin = {
  id: 'qdpx',
  // Note: QDPX export does not currently include memos — use HTML or CSV export for full memo content.
  label: 'REFI-QDA Project (.qdpx)',
  fileExtension: 'qdpx',
  mimeType: 'application/zip',
  
  async export(payload: ExportPayload): Promise<Uint8Array> {
    const impl = new DOMImplementation();
    const doc = impl.createDocument('urn:QDA-XML:project:1.0', 'Project', null);
    const root = doc.documentElement;
    if (!root) throw new Error("Failed to create XML root");
    
    root.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
    root.setAttribute('xsi:schemaLocation', 'urn:QDA-XML:project:1.0 http://schema.qdasoftware.org/versions/Project/v1.0/Project.xsd');
    root.setAttribute('name', payload.project.name);
    root.setAttribute('creatingUserGUID', payload.localUser.id);
    root.setAttribute('creationDateTime', payload.project.createdAt);
    root.setAttribute('modifiedDateTime', payload.project.updatedAt);

    // Users
    const usersEl = doc.createElement('Users');
    const userEl = doc.createElement('User');
    userEl.setAttribute('guid', payload.localUser.id);
    userEl.setAttribute('name', payload.localUser.displayName);
    usersEl.appendChild(userEl);
    root.appendChild(usersEl);

    // CodeBook
    const codeBookEl = doc.createElement('CodeBook');
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
    codeBookEl.appendChild(codesEl);
    root.appendChild(codeBookEl);

    // Sources
    const sourcesEl = doc.createElement('Sources');
    for (const document of payload.documents) {
      const sourceEl = doc.createElement('TextSource');
      sourceEl.setAttribute('guid', document.id);
      sourceEl.setAttribute('name', document.title);
      
      sourceEl.setAttribute('plainTextPath', `${document.id}.txt`);
      if (document.fileFormat !== 'txt') {
         const ext = document.originalPath?.split('.').pop() ?? document.fileFormat;
         sourceEl.setAttribute('richTextPath', `${document.id}.${ext}`);
      }
      
      sourceEl.setAttribute('creatingUser', payload.localUser.id);
      sourceEl.setAttribute('creationDateTime', document.importedAt);

      // Add annotations for this document
      const docAnnotations = payload.annotations.filter(a => a.documentId === document.id);
      for (const ann of docAnnotations) {
        const selEl = doc.createElement('PlainTextSelection');
        selEl.setAttribute('guid', ann.id);
        selEl.setAttribute('name', '');
        selEl.setAttribute('startPosition', ann.startChar.toString());
        selEl.setAttribute('endPosition', ann.endChar.toString());
        selEl.setAttribute('creatingUser', payload.localUser.id);
        selEl.setAttribute('creationDateTime', ann.createdAt);

        const codingEl = doc.createElement('Coding');
        // generate a random guid for the coding link itself, UUID v4 style
        codingEl.setAttribute('guid', crypto.randomUUID());
        codingEl.setAttribute('creatingUser', payload.localUser.id);
        codingEl.setAttribute('creationDateTime', ann.createdAt);

        const codeRefEl = doc.createElement('CodeRef');
        codeRefEl.setAttribute('targetGUID', ann.codeId);
        codingEl.appendChild(codeRefEl);
        
        selEl.appendChild(codingEl);
        sourceEl.appendChild(selEl);
      }

      sourcesEl.appendChild(sourceEl);
    }
    root.appendChild(sourcesEl);

    // Serialize
    const serializer = new XMLSerializer();
    const xmlString = `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(doc)}`;

    const zip = new JSZip();
    zip.file('project.qde', xmlString);
    
    const sourcesZip = zip.folder('Sources');
    if (sourcesZip) {
      for (const document of payload.documents) {
        // Always write the normalized plain text
        sourcesZip.file(`${document.id}.txt`, document.plainText ?? '');

        // For non-TXT sources, attempt to bundle the original as richTextPath
        if (document.fileFormat !== 'txt') {
          const ext = document.originalPath?.split('.').pop() ?? document.fileFormat;
          const originalFilename = `${document.id}.${ext}`;
          try {
            const assetPath = `${payload.projectFolderPath}/assets/${originalFilename}`;
            const fileData = await readFile(assetPath);
            sourcesZip.file(originalFilename, fileData);
          } catch {
            // No richTextPath if asset wasn't copied at import time — acceptable fallback
          }
        }
      }
    }

    return await zip.generateAsync({ type: 'uint8array' });
  }
};

exporterRegistry.register(QdpxExporter);
