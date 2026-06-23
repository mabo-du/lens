import { useEffect, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useUiStore } from '@/store/uiStore';
import { useProjectStore } from '@/store/projectStore';
import { flattenCodeTree } from './QdaAnnotationPlugin';
import { annotationsIpc } from '@/ipc/annotations';
import { toast } from 'sonner';

export function FuzzyCodePicker() {
  const textSelection = useUiStore(s => s.textSelection);
  const activeDocumentId = useUiStore(s => s.activeDocumentId);
  const clearTextSelection = useUiStore(s => s.clearTextSelection);
  const codes = useProjectStore(s => s.codes);
  const addAnnotation = useProjectStore(s => s.addAnnotation);
  const pushUndo = useUiStore(s => s.pushUndo);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (textSelection && activeDocumentId) {
          setOpen(true);
        }
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [textSelection, activeDocumentId]);

  const handleSelectCode = async (codeId: string) => {
    if (!textSelection || !activeDocumentId) return;

    setOpen(false);
    try {
      const ann = await annotationsIpc.create({
        documentId: activeDocumentId,
        codeId,
        startChar: textSelection.startChar,
        endChar: textSelection.endChar,
      });
      addAnnotation(ann);
      pushUndo({ action: 'delete', annotation: ann });
    } catch (e) {
      console.error("Failed to create annotation", e);
      toast.error("Failed to save annotation.");
    } finally {
      clearTextSelection();
    }
  };

  const flatCodes = flattenCodeTree(codes);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 overflow-hidden">
        <Command>
          <CommandInput placeholder="Search codes to assign..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Codes">
              {flatCodes.map(code => (
                <CommandItem
                  key={code.id}
                  value={code.name}
                  onSelect={() => handleSelectCode(code.id)}
                >
                  <div 
                    className="w-3 h-3 rounded-full mr-2 shrink-0 border border-black/20"
                    style={{ backgroundColor: code.color }}
                  />
                  <span>{code.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
